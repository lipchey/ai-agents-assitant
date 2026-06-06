import { END, START, StateGraph } from "@langchain/langgraph";
import { WorkerKind, WorkerStatus } from "./enums.js";
import { SystemPrompts } from "./prompts.js";
import { GraphState, type UsageBreakdown } from "./state.js";
import { buildSwarm } from "./swarm.js";
import { callLlm, openclawRpc, type LlmCallResult } from "./tools/openclaw.js";

const MAX_DEBATE_ITERATIONS = 4;
// Hard caps on the two reentrant cycles. The swarm runs once on the primary
// route, so allowing 2 total context fetches permits exactly one debate-driven
// refetch before we stop paying for redundant (and, for codeExplorer,
// deterministic) tool runs plus an Opus architect pass each loop.
const MAX_CONTEXT_FETCHES = 2;
const MAX_VERIFY_ATTEMPTS = 2;
const COST_BUDGET_SOFT_CEILING_RATIO = 0.95;
const COST_BUDGET_MIN_REMAINING_USD = 0.005;
const PROJECTED_CONTEXT_REFETCH_CYCLE_USD = 0.08;
const PROJECTED_STRONG_ARCHITECT_USD = 0.05;
const PROJECTED_CODER_REVIEW_CYCLE_USD = 0.06;
const PROJECTED_STRONG_CRITIC_USD = 0.05;
const PROJECTED_SME_TIEBREAKER_USD = 0.05;

type GraphStateValue = typeof GraphState.State;

type RouterDecision = {
    complexity: "trivial" | "tool_complex" | "pure_reasoning";
    routeConfidence: number;
};

type CriticDecision = {
    consensus: boolean;
    needsMoreContext: boolean;
    critique: string;
};

type FrontierArchitectureDecision = {
    architectureSpec: string;
    confidence: number;
    escalateToStrong: boolean;
    escalationReason: string;
};

type FrontierCriticDecision = CriticDecision & {
    confidence: number;
    requiresStrongCritic: boolean;
    escalationReason: string;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const usageFromLlm = (result: LlmCallResult): UsageBreakdown => ({
    cost: result.cost,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedInputTokens: result.cachedInputTokens,
    cacheMissInputTokens: result.cacheMissInputTokens,
    cacheWriteInputTokens: result.cacheWriteInputTokens,
});

const readCostBudgetUsd = (state: GraphStateValue): number => {
    const budget = state.costBudgetUsd;
    return typeof budget === "number" && Number.isFinite(budget) && budget > 0
        ? budget
        : Number.POSITIVE_INFINITY;
};

const isCostBudgetNear = (state: GraphStateValue, projectedCostUsd = 0): boolean => {
    const budget = readCostBudgetUsd(state);
    if (!Number.isFinite(budget)) {
        return false;
    }
    const actualCost = state.totalCost ?? 0;
    const softCeiling = budget * COST_BUDGET_SOFT_CEILING_RATIO;
    return actualCost + projectedCostUsd >= softCeiling
        || budget - actualCost <= COST_BUDGET_MIN_REMAINING_USD;
};

const canSpendUsd = (state: GraphStateValue, projectedCostUsd: number): boolean => {
    return !isCostBudgetNear(state, projectedCostUsd);
};

const STRONG_ESCALATION_SIGNALS = [
    /\bsecurity|authentication|authorization|authz|authn|crypto|encrypt|secret|token|permission\b/iu,
    /\bpayment|billing|invoice|pci|hipaa|gdpr|privacy|compliance|legal\b/iu,
    /\bproduction|prod|migration|database|schema|data loss|destructive|delete|rollback\b/iu,
    /\bconcurrency|distributed|race condition|deadlock|consistency|transaction\b/iu,
    /\bmulti-agent|orchestration|autonomous|human-in-the-loop|hitl|checkpointer\b/iu,
];

const strongEscalationReasonForTask = (task: string): string | undefined => {
    const signal = STRONG_ESCALATION_SIGNALS.find((pattern) => pattern.test(task));
    return signal ? `Task matched high-risk escalation signal: ${signal.source}` : undefined;
};

const extractJsonObject = (text: string): unknown => {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
    const candidate = fenced?.[1] ?? text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end < start) {
        return null;
    }
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
};

const heuristicComplexity = (task: string): RouterDecision => {
    const normalized = task.toLowerCase();
    const toolSignals = [
        "project",
        "repo",
        "code",
        "bug",
        "fix",
        "test",
        "openclaw",
        "typescript",
        "langgraph",
        "file",
        "implementation",
    ];
    const reasoningSignals = ["explain", "design", "architecture", "compare", "plan"];

    if (toolSignals.some((signal) => normalized.includes(signal))) {
        return { complexity: "tool_complex", routeConfidence: 0.75 };
    }
    if (reasoningSignals.some((signal) => normalized.includes(signal))) {
        return { complexity: "pure_reasoning", routeConfidence: 0.65 };
    }
    return { complexity: "trivial", routeConfidence: 0.6 };
};

const parseRouterDecision = (content: string, task: string): RouterDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const complexity = parsed?.complexity;
    const confidence = parsed?.routeConfidence;

    if (
        (complexity === "trivial" || complexity === "tool_complex" || complexity === "pure_reasoning")
        && typeof confidence === "number"
    ) {
        return { complexity, routeConfidence: clamp01(confidence) };
    }

    return heuristicComplexity(task);
};

const parseCriticDecision = (content: string): CriticDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const consensus = typeof parsed?.consensus === "boolean" ? parsed.consensus : /\bLGTM\b|approved|looks good/iu.test(content);
    const needsMoreContext = typeof parsed?.needsMoreContext === "boolean" ? parsed.needsMoreContext : /need(s)? more context|missing context/iu.test(content);
    const critique = typeof parsed?.critique === "string" ? parsed.critique : content;
    return { consensus, needsMoreContext, critique };
};

const parseFrontierArchitectureDecision = (content: string): FrontierArchitectureDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const architectureSpec = typeof parsed?.architectureSpec === "string" && parsed.architectureSpec.trim()
        ? parsed.architectureSpec.trim()
        : content;
    const confidence = typeof parsed?.confidence === "number" ? clamp01(parsed.confidence) : 0.55;
    const escalateToStrong = typeof parsed?.escalateToStrong === "boolean"
        ? parsed.escalateToStrong
        : confidence < 0.72;
    const escalationReason = typeof parsed?.escalationReason === "string" && parsed.escalationReason.trim()
        ? parsed.escalationReason.trim()
        : confidence < 0.72
            ? "Frontier architect confidence below 0.72."
            : "";

    return { architectureSpec, confidence, escalateToStrong, escalationReason };
};

const parseFrontierCriticDecision = (content: string): FrontierCriticDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const baseDecision = parseCriticDecision(content);
    const confidence = typeof parsed?.confidence === "number" ? clamp01(parsed.confidence) : 0.55;
    const requiresStrongCritic = typeof parsed?.requiresStrongCritic === "boolean"
        ? parsed.requiresStrongCritic
        : confidence < 0.72;
    const escalationReason = typeof parsed?.escalationReason === "string" && parsed.escalationReason.trim()
        ? parsed.escalationReason.trim()
        : confidence < 0.72
            ? "Frontier critic confidence below 0.72."
            : "";

    return { ...baseDecision, confidence, requiresStrongCritic, escalationReason };
};

const selectWorkerKind = (task: string): WorkerKind => {
    const normalized = task.toLowerCase();
    if (/\b(latest|docs|documentation|web|internet|search|browse|research)\b/u.test(normalized)) {
        return WorkerKind.WEB_RESEARCHER;
    }
    if (/\b(test|build|compile|tsc|npm|shell|command|docker|infra)\b/u.test(normalized)) {
        return WorkerKind.INFRA_OPS;
    }
    return WorkerKind.CODE_EXPLORER;
};

const CONTEXT_TERM_STOP_WORDS = new Set([
    "about",
    "after",
    "agent",
    "because",
    "before",
    "check",
    "code",
    "context",
    "critique",
    "current",
    "draft",
    "evidence",
    "fetch",
    "find",
    "frontier",
    "implementation",
    "latest",
    "missing",
    "more",
    "needs",
    "original",
    "project",
    "reason",
    "repository",
    "request",
    "search",
    "should",
    "state",
    "subtask",
    "summary",
    "targeted",
    "task",
    "that",
    "this",
    "true",
    "what",
    "where",
]);

const extractContextSearchTerms = (text: string): string[] => {
    const terms = new Map<string, number>();
    const matches = text.matchAll(/`([^`]{2,80})`|\b[A-Za-z][A-Za-z0-9_./-]{2,}\b/gu);
    for (const match of matches) {
        const rawTerm = (match[1] ?? match[0]).trim();
        const normalized = rawTerm.replace(/^["'([{]+|["')\]}.,:;]+$/gu, "");
        const lower = normalized.toLowerCase();
        if (
            normalized.length < 3
            || CONTEXT_TERM_STOP_WORDS.has(lower)
            || /^\d+$/u.test(normalized)
        ) {
            continue;
        }
        const score = (/[A-Z_./-]/u.test(normalized) ? 2 : 1) + Math.min(3, Math.floor(normalized.length / 12));
        terms.set(normalized, Math.max(terms.get(normalized) ?? 0, score));
    }

    return [...terms.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([term]) => term);
};

const buildSwarmSubtask = (state: GraphStateValue): string => {
    if (state.needsMoreContext && (state.debateSummary || state.debateThread.length > 0)) {
        const latestCritique = state.debateThread.at(-1)?.critique;
        const critiqueContext = [
            state.debateSummary ? `Debate summary:\n${state.debateSummary}` : "",
            latestCritique ? `Latest critique:\n${latestCritique}` : "",
        ].filter(Boolean).join("\n\n");
        const searchTerms = extractContextSearchTerms(critiqueContext);
        return [
            "Targeted context request for repository inspection.",
            `Original task:\n${state.originalTask}`,
            "Critique/debate summary that triggered needsMoreContext=true:",
            critiqueContext,
            searchTerms.length > 0 ? `Search focus terms: ${searchTerms.join(", ")}` : "",
            "Return only evidence that directly resolves this missing context. Avoid repeating broad repository inventory unless the critique requires it.",
        ].filter(Boolean).join("\n\n");
    }
    return state.originalTask;
};

const extractToolStatus = (report: Record<string, unknown>): { status: string; exitCode?: number } => {
    const details = asRecord(report.details);
    const status = typeof details?.status === "string"
        ? details.status
        : typeof report.status === "string"
            ? report.status
            : "";
    const exitCode = typeof details?.exitCode === "number"
        ? details.exitCode
        : typeof report.exitCode === "number"
            ? report.exitCode
            : undefined;
    return exitCode === undefined ? { status } : { status, exitCode };
};

const complexityRouter = async (state: GraphStateValue) => {
    const result = await callLlm(
        "router",
        SystemPrompts.complexityRouter,
        state.originalTask,
        { maxTokens: 160, responseFormat: "json_object", thinking: "disabled" },
    );
    const decision = parseRouterDecision(result.content, state.originalTask);

    return {
        complexity: decision.complexity,
        routeConfidence: decision.routeConfidence,
        costBudgetUsd: state.costBudgetUsd ?? 1,
        debateIterations: 0,
        consensusReached: false,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { router: usageFromLlm(result) },
    };
};

const directResponder = async (state: GraphStateValue) => {
    const result = await callLlm(
        "router",
        SystemPrompts.directResponder,
        state.originalTask,
        { maxTokens: 800, thinking: "disabled" },
    );
    return {
        currentDraft: result.content,
        bestDraft: result.content,
        consensusReached: true,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { direct: usageFromLlm(result) },
    };
};

const swarmNode = async (state: GraphStateValue) => {
    const swarm = buildSwarm();
    const subtask = buildSwarmSubtask(state);
    const result = await swarm.invoke({
        subtask,
        workerKind: selectWorkerKind(subtask),
        status: WorkerStatus.PENDING,
        attempts: 0,
        escalationAttempts: 0,
    });
    const fallbackSummary = [
        `Swarm finished with status: ${result.status ?? "unknown"}.`,
        result.escalationQuery ? `Escalation query: ${result.escalationQuery}` : "",
        result.rawToolOutput ? `Raw output was captured in artifacts.` : "",
    ].filter(Boolean).join(" ");

    return {
        swarmSummary: result.workerSummary || result.rawToolOutput || fallbackSummary,
        swarmStatus: result.status,
        artifactIndex: result.producedArtifacts,
        contextFetches: (state.contextFetches ?? 0) + 1,
        totalCost: result.totalCost,
        totalTokens: result.totalTokens,
        usageStats: result.usageStats,
    };
};

const firewall = async (state: GraphStateValue) => {
    const compressedContext = state.swarmSummary
        ? state.swarmSummary
        : JSON.stringify({
            note: "No execution context was gathered.",
            artifacts: state.artifactIndex,
        });
    return { compressedContext };
};

const frontierArchitect = async (state: GraphStateValue) => {
    const result = await callLlm(
        "frontier",
        SystemPrompts.frontierArchitect,
        [
            `Task:\n${state.originalTask}`,
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
        { maxTokens: 2_400, reasoningEffort: "high", responseFormat: "json_object", thinking: "enabled" },
    );
    const decision = parseFrontierArchitectureDecision(result.content);
    const deterministicReason = strongEscalationReasonForTask(state.originalTask);
    const strongEscalationRequired = Boolean(deterministicReason) || decision.escalateToStrong || decision.confidence < 0.72;
    const strongEscalationReason = deterministicReason
        ?? decision.escalationReason
        ?? (strongEscalationRequired ? "Frontier architect requested strong-model escalation." : "");

    return {
        architectureSpec: decision.architectureSpec,
        frontierDraft: decision.architectureSpec,
        frontierConfidence: decision.confidence,
        strongEscalationRequired,
        strongEscalationReason,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { frontierArchitect: usageFromLlm(result) },
    };
};

const claudeArchitect = async (state: GraphStateValue) => {
    const result = await callLlm(
        "architect",
        SystemPrompts.claudeArchitect,
        [
            `Task:\n${state.originalTask}`,
            state.frontierDraft ? `Low-cost frontier draft to verify or improve:\n${state.frontierDraft}` : "",
            state.strongEscalationReason ? `Escalation reason:\n${state.strongEscalationReason}` : "",
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
        { thinking: "adaptive", reasoningEffort: "high" },
    );

    return {
        architectureSpec: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { architect: usageFromLlm(result) },
    };
};

const claudeCoder = async (state: GraphStateValue) => {
    const result = await callLlm(
        "coder",
        SystemPrompts.claudeCoder,
        [
            `Spec:\n${state.architectureSpec}`,
            `Critiques to fix:\n${state.debateSummary || "None"}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
    );

    return {
        currentDraft: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { coder: usageFromLlm(result) },
    };
};

const frontierCritic = async (state: GraphStateValue) => {
    const result = await callLlm(
        "frontier",
        SystemPrompts.frontierCritic,
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-3))}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
        { maxTokens: 1_400, reasoningEffort: "high", responseFormat: "json_object", thinking: "enabled" },
    );
    const decision = parseFrontierCriticDecision(result.content);
    const deterministicReason = strongEscalationReasonForTask(state.originalTask);
    const strongCriticRequired = Boolean(deterministicReason) || decision.requiresStrongCritic || decision.confidence < 0.72;
    const criticEscalationReason = deterministicReason
        ?? decision.escalationReason
        ?? (strongCriticRequired ? "Frontier critic requested strong-model review." : "");

    return {
        debateThread: [{ round: state.debateIterations, critique: `[frontier] ${decision.critique}` }],
        debateSummary: decision.critique,
        debateIterations: state.debateIterations + 1,
        consensusReached: decision.consensus,
        needsMoreContext: decision.needsMoreContext,
        criticConfidence: decision.confidence,
        strongCriticRequired,
        criticEscalationReason,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { frontierCritic: usageFromLlm(result) },
    };
};

const openaiCritic = async (state: GraphStateValue) => {
    const result = await callLlm(
        "critic",
        SystemPrompts.openaiCritic,
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            state.criticEscalationReason ? `Frontier critic escalation reason:\n${state.criticEscalationReason}` : "",
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-3))}`,
        ].filter(Boolean).join("\n\n"),
        { maxTokens: 1_400, responseFormat: "json_object" },
    );
    const decision = parseCriticDecision(result.content);
    const frontierAlreadyCounted = state.strongCriticRequired;
    const debateRound = frontierAlreadyCounted ? Math.max(0, state.debateIterations - 1) : state.debateIterations;

    return {
        debateThread: [{ round: debateRound, critique: `[strong] ${decision.critique}` }],
        debateSummary: decision.critique,
        debateIterations: state.debateIterations + (frontierAlreadyCounted ? 0 : 1),
        consensusReached: decision.consensus,
        needsMoreContext: decision.needsMoreContext,
        strongCriticRequired: false,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { critic: usageFromLlm(result) },
    };
};

const smeTiebreaker = async (state: GraphStateValue) => {
    const result = await callLlm(
        "sme",
        SystemPrompts.smeTiebreaker,
        [
            `Task:\n${state.originalTask}`,
            `Current draft:\n${state.currentDraft}`,
            `Debate summary:\n${state.debateSummary}`,
        ].join("\n\n"),
        { thinking: "adaptive", reasoningEffort: "high" },
    );
    return {
        currentDraft: result.content,
        consensusReached: true,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { sme: usageFromLlm(result) },
    };
};

const verify = async (state: GraphStateValue) => {
    const verifyAttempts = (state.verifyAttempts ?? 0) + 1;

    // Pure-reasoning output (designs, explanations, plans) has no code to
    // compile, so running `npm run typecheck` here proves nothing and only
    // produces a misleading "verificationReport". Accept the consensus draft.
    if (state.complexity === "pure_reasoning") {
        return {
            verificationPassed: true,
            verificationReport: "Skipped objective typecheck: pure_reasoning output has no code to compile.",
            bestDraft: state.currentDraft || state.bestDraft || "",
            verifyAttempts,
        };
    }

    try {
        const report = await openclawRpc(
            "run_tests",
            { command: "npm run typecheck", timeout: 120 },
            { timeoutS: 150, idempotencyKey: `verify-${state.debateIterations}`, maxRetries: 0 },
        );
        const { status, exitCode } = extractToolStatus(report);
        const passed = status === "completed" && (exitCode === undefined || exitCode === 0);

        return {
            verificationPassed: passed,
            verificationReport: JSON.stringify(report, null, 2),
            bestDraft: passed ? state.currentDraft : state.bestDraft || "",
            verifyAttempts,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            verificationPassed: false,
            verificationReport: `Verification failed before tests completed: ${message}`,
            verifyAttempts,
        };
    }
};

const finalize = async (state: GraphStateValue) => {
    const answer = state.bestDraft || state.currentDraft || state.architectureSpec || "";
    return { finalAnswer: answer };
};

const routeByComplexity = (state: GraphStateValue): string => {
    if (state.complexity === "trivial") {
        return "directResponder";
    }
    if (state.complexity === "pure_reasoning") {
        return "frontierArchitect";
    }
    return "swarm";
};

const routeAfterFrontierArchitect = (state: GraphStateValue): string => {
    if (isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD)) {
        return "finalize";
    }
    if (state.complexity === "pure_reasoning") {
        if (state.strongEscalationRequired && canSpendUsd(state, PROJECTED_STRONG_ARCHITECT_USD)) {
            return "claudeArchitect";
        }
        return "finalize";
    }
    if (state.strongEscalationRequired && canSpendUsd(state, PROJECTED_STRONG_ARCHITECT_USD + PROJECTED_CODER_REVIEW_CYCLE_USD)) {
        return "claudeArchitect";
    }
    return "claudeCoder";
};

const routeAfterClaudeArchitect = (state: GraphStateValue): string => {
    return state.complexity === "pure_reasoning" ? "finalize" : "claudeCoder";
};

const routeDebate = (state: GraphStateValue): string => {
    if (isCostBudgetNear(state)) {
        return "verify";
    }
    // Consensus wins over a late "needs more context" so we don't bounce back
    // into the swarm after the critic has already approved the draft.
    if (state.consensusReached) {
        return "verify";
    }
    // Only refetch context while under the hard cap. Without this, a critic that
    // keeps asking for more context loops swarm -> firewall -> architect(Opus)
    // -> coder -> critic indefinitely (re-running deterministic tools), burning
    // frontier tokens and tripping the graph recursion limit before the USD
    // budget guard can stop later loops.
    if (
        state.needsMoreContext
        && (state.contextFetches ?? 0) < MAX_CONTEXT_FETCHES
        && canSpendUsd(state, PROJECTED_CONTEXT_REFETCH_CYCLE_USD)
    ) {
        return "swarm";
    }
    if (state.debateIterations >= MAX_DEBATE_ITERATIONS) {
        return canSpendUsd(state, PROJECTED_SME_TIEBREAKER_USD) ? "smeTiebreaker" : "verify";
    }
    return canSpendUsd(state, PROJECTED_CODER_REVIEW_CYCLE_USD) ? "claudeCoder" : "verify";
};

const routeAfterFrontierCritic = (state: GraphStateValue): string => {
    if (state.strongCriticRequired && canSpendUsd(state, PROJECTED_STRONG_CRITIC_USD)) {
        return "openaiCritic";
    }
    return routeDebate(state);
};

const routeAfterVerify = (state: GraphStateValue): string => {
    // Stop the verify/fix cycle once budget or the attempt cap is reached.
    // Patches are not applied to disk, so an objectively failing typecheck can
    // never be "fixed" by another coder pass here; cap it to avoid wasted loops.
    if (
        state.verificationPassed
        || isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD)
        || (state.verifyAttempts ?? 0) >= MAX_VERIFY_ATTEMPTS
    ) {
        return "finalize";
    }
    return "claudeCoder";
};

export const buildMainGraph = () => {
    return new StateGraph(GraphState)
        .addNode("complexityRouter", complexityRouter)
        .addNode("directResponder", directResponder)
        .addNode("swarm", swarmNode)
        .addNode("firewall", firewall)
        .addNode("frontierArchitect", frontierArchitect)
        .addNode("claudeArchitect", claudeArchitect)
        .addNode("claudeCoder", claudeCoder)
        .addNode("frontierCritic", frontierCritic)
        .addNode("openaiCritic", openaiCritic)
        .addNode("smeTiebreaker", smeTiebreaker)
        .addNode("verify", verify)
        .addNode("finalize", finalize)
        .addEdge(START, "complexityRouter")
        .addConditionalEdges("complexityRouter", routeByComplexity, {
            directResponder: "directResponder",
            swarm: "swarm",
            frontierArchitect: "frontierArchitect",
        })
        .addEdge("directResponder", "finalize")
        .addEdge("swarm", "firewall")
        .addEdge("firewall", "frontierArchitect")
        .addConditionalEdges("frontierArchitect", routeAfterFrontierArchitect, {
            claudeArchitect: "claudeArchitect",
            claudeCoder: "claudeCoder",
            finalize: "finalize",
        })
        .addConditionalEdges("claudeArchitect", routeAfterClaudeArchitect, {
            claudeCoder: "claudeCoder",
            finalize: "finalize",
        })
        .addEdge("claudeCoder", "frontierCritic")
        .addConditionalEdges("frontierCritic", routeAfterFrontierCritic, {
            claudeCoder: "claudeCoder",
            swarm: "swarm",
            smeTiebreaker: "smeTiebreaker",
            verify: "verify",
            openaiCritic: "openaiCritic",
        })
        .addConditionalEdges("openaiCritic", routeDebate, {
            claudeCoder: "claudeCoder",
            swarm: "swarm",
            smeTiebreaker: "smeTiebreaker",
            verify: "verify",
        })
        .addEdge("smeTiebreaker", "verify")
        .addConditionalEdges("verify", routeAfterVerify, {
            finalize: "finalize",
            claudeCoder: "claudeCoder",
        })
        .addEdge("finalize", END)
        .compile();
};
