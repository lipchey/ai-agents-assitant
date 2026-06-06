import { END, START, StateGraph } from "@langchain/langgraph";
import { WorkerKind, WorkerStatus } from "./enums.js";
import { GraphState } from "./state.js";
import { buildSwarm } from "./swarm.js";
import { callLlm, openclawRpc } from "./tools/openclaw.js";

const MAX_DEBATE_ITERATIONS = 4;
// Hard caps on the two reentrant cycles. The swarm runs once on the primary
// route, so allowing 2 total context fetches permits exactly one debate-driven
// refetch before we stop paying for redundant (and, for codeExplorer,
// deterministic) tool runs plus an Opus architect pass each loop.
const MAX_CONTEXT_FETCHES = 2;
const MAX_VERIFY_ATTEMPTS = 2;
const ARCHITECT_COST = 5;
const CODER_COST = 3;
const CRITIC_COST = 4;
const SME_COST = 6;
const VERIFY_COST = 1;

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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

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

const buildSwarmSubtask = (state: GraphStateValue): string => {
    if (state.needsMoreContext && state.debateSummary) {
        return `Gather missing implementation context for: ${state.debateSummary}`;
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
    const { content, cost, tokens } = await callLlm(
        "router",
        [
            "Classify the user task for an autonomous software agent.",
            "Return only JSON:",
            "{\"complexity\":\"trivial|pure_reasoning|tool_complex\",\"routeConfidence\":0.0}",
            "Use tool_complex when repository inspection, execution, current docs, or file changes are needed.",
        ].join(" "),
        state.originalTask,
    );
    const decision = parseRouterDecision(content, state.originalTask);

    return {
        complexity: decision.complexity,
        routeConfidence: decision.routeConfidence,
        tokenBudget: state.tokenBudget ?? 100,
        debateIterations: 0,
        consensusReached: false,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { router: { cost, tokens } },
    };
};

const directResponder = async (state: GraphStateValue) => {
    const { content, cost, tokens } = await callLlm(
        "router",
        "Answer the user directly and concisely. Do not invent tool results.",
        state.originalTask,
    );
    return {
        currentDraft: content,
        bestDraft: content,
        consensusReached: true,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { direct: { cost, tokens } },
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

const claudeArchitect = async (state: GraphStateValue) => {
    const { content, cost, tokens } = await callLlm(
        "architect",
        [
            "You are the architecture lead.",
            "Produce a concise technical specification or correction plan.",
            "Use only the supplied task, compressed execution context, and verification feedback.",
        ].join(" "),
        [
            `Task:\n${state.originalTask}`,
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
    );

    return {
        architectureSpec: content,
        tokenBudget: Math.max(0, state.tokenBudget - ARCHITECT_COST),
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { architect: { cost, tokens } },
    };
};

const claudeCoder = async (state: GraphStateValue) => {
    const { content, cost, tokens } = await callLlm(
        "coder",
        [
            "You are the implementation agent.",
            "Produce the smallest concrete draft that satisfies the architecture and critique.",
            "When code changes are required, describe exact patches and verification commands.",
        ].join(" "),
        [
            `Spec:\n${state.architectureSpec}`,
            `Critiques to fix:\n${state.debateSummary || "None"}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
    );

    return {
        currentDraft: content,
        tokenBudget: Math.max(0, state.tokenBudget - CODER_COST),
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { coder: { cost, tokens } },
    };
};

const openaiCritic = async (state: GraphStateValue) => {
    const { content, cost, tokens } = await callLlm(
        "critic",
        [
            "Critique the draft. Do not rewrite it.",
            "Return only JSON with keys:",
            "{\"consensus\":boolean,\"needsMoreContext\":boolean,\"critique\":\"string\"}",
            "Set consensus true only when the draft is ready for objective verification.",
        ].join(" "),
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-3))}`,
        ].join("\n\n"),
    );
    const decision = parseCriticDecision(content);

    return {
        debateThread: [{ round: state.debateIterations, critique: decision.critique }],
        debateSummary: decision.critique,
        debateIterations: state.debateIterations + 1,
        consensusReached: decision.consensus,
        needsMoreContext: decision.needsMoreContext,
        tokenBudget: Math.max(0, state.tokenBudget - CRITIC_COST),
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { critic: { cost, tokens } },
    };
};

const smeTiebreaker = async (state: GraphStateValue) => {
    const { content, cost, tokens } = await callLlm(
        "sme",
        "Make the final call. Return the best corrected draft, not a meta-discussion.",
        [
            `Task:\n${state.originalTask}`,
            `Current draft:\n${state.currentDraft}`,
            `Debate summary:\n${state.debateSummary}`,
        ].join("\n\n"),
    );
    return {
        currentDraft: content,
        consensusReached: true,
        tokenBudget: Math.max(0, state.tokenBudget - SME_COST),
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { sme: { cost, tokens } },
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
            tokenBudget: Math.max(0, state.tokenBudget - VERIFY_COST),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            verificationPassed: false,
            verificationReport: `Verification failed before tests completed: ${message}`,
            verifyAttempts,
            tokenBudget: Math.max(0, state.tokenBudget - VERIFY_COST),
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
        return "claudeArchitect";
    }
    return "swarm";
};

const routeDebate = (state: GraphStateValue): string => {
    if ((state.tokenBudget ?? 0) <= 0) {
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
    // frontier tokens and tripping the graph recursion limit before tokenBudget
    // ever drains.
    if (state.needsMoreContext && (state.contextFetches ?? 0) < MAX_CONTEXT_FETCHES) {
        return "swarm";
    }
    if (state.debateIterations >= MAX_DEBATE_ITERATIONS) {
        return "smeTiebreaker";
    }
    return "claudeCoder";
};

const routeAfterVerify = (state: GraphStateValue): string => {
    // Stop the verify/fix cycle once budget or the attempt cap is reached.
    // Patches are not applied to disk, so an objectively failing typecheck can
    // never be "fixed" by another coder pass here; cap it to avoid wasted loops.
    if (
        state.verificationPassed
        || (state.tokenBudget ?? 0) <= 0
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
        .addNode("claudeArchitect", claudeArchitect)
        .addNode("claudeCoder", claudeCoder)
        .addNode("openaiCritic", openaiCritic)
        .addNode("smeTiebreaker", smeTiebreaker)
        .addNode("verify", verify)
        .addNode("finalize", finalize)
        .addEdge(START, "complexityRouter")
        .addConditionalEdges("complexityRouter", routeByComplexity, {
            directResponder: "directResponder",
            swarm: "swarm",
            claudeArchitect: "claudeArchitect",
        })
        .addEdge("directResponder", "finalize")
        .addEdge("swarm", "firewall")
        .addEdge("firewall", "claudeArchitect")
        .addEdge("claudeArchitect", "claudeCoder")
        .addEdge("claudeCoder", "openaiCritic")
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
