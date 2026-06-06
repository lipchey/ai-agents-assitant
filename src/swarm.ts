import { END, START, StateGraph } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";
import { SystemPrompts } from "./prompts.js";
import { SwarmWorkerState, type ToolCallRecord, type UsageBreakdown } from "./state.js";
import { callLlm, openclawRpc, storeArtifact, type LlmCallResult, type OpenClawRpcArgs } from "./tools/openclaw.js";

const MAX_ESCALATION_ATTEMPTS = 2;
const DEFAULT_CODE_GREP_PATTERN = "OpenClaw|openclawRpc|callLlm|StateGraph|Annotation";
const TARGETED_CONTEXT_MARKER = "Targeted context request";

type WorkerState = typeof SwarmWorkerState.State;

type WorkerToolPlan = {
    tool: string;
    args: OpenClawRpcArgs;
};

const usageFromLlm = (result: LlmCallResult): UsageBreakdown => ({
    cost: result.cost,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedInputTokens: result.cachedInputTokens,
    cacheMissInputTokens: result.cacheMissInputTokens,
    cacheWriteInputTokens: result.cacheWriteInputTokens,
});

const stringifyToolResult = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const readRecord = (value: unknown): Record<string, unknown> | null => {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
};

const readExitCode = (value: unknown): number | undefined => {
    const record = readRecord(value);
    const details = readRecord(record?.details);
    const exitCode = details?.exitCode ?? record?.exitCode;
    return typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : undefined;
};

const classifyFailure = (errorMessage: string): FailureType => {
    const normalized = errorMessage.toLowerCase();
    if (
        normalized.includes("not available")
        || normalized.includes("not found")
        || normalized.includes("unauthorized")
        || normalized.includes("permission")
        || normalized.includes("gateway")
        || normalized.includes("timeout")
    ) {
        return FailureType.ENVIRONMENT;
    }
    return FailureType.REASONING;
};

const SAFE_INFRA_COMMANDS = new Set([
    "git status --short",
    "npm run build",
    "npm run test",
    "npm run typecheck",
    "npm test",
    "npx tsc --noEmit",
]);

const parseInfraCommand = (subtask: string): string => {
    const trimmed = subtask.trim();
    const explicit = /^(?:command|shell)\s*:\s*(.+)$/iu.exec(trimmed)?.[1]?.trim();
    const candidate = explicit ?? trimmed;
    return SAFE_INFRA_COMMANDS.has(candidate) ? candidate : "npm run typecheck";
};

const TARGETED_GREP_STOP_WORDS = new Set([
    "avoid",
    "broad",
    "context",
    "critique",
    "debate",
    "directly",
    "evidence",
    "focus",
    "frontier",
    "implementation",
    "inventory",
    "latest",
    "missing",
    "needed",
    "original",
    "repository",
    "request",
    "resolves",
    "search",
    "summary",
    "targeted",
    "terms",
    "that",
    "this",
    "true",
    "triggered",
    "unless",
]);

const escapeRegex = (value: string): string => value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");

const extractTargetedTerms = (subtask: string): string[] => {
    const explicitTerms = /Search focus terms:\s*([^\n]+)/iu.exec(subtask)?.[1]
        ?.split(",")
        .map((term) => term.trim())
        .filter(Boolean);
    const candidates = explicitTerms && explicitTerms.length > 0
        ? explicitTerms
        : [...subtask.matchAll(/`([^`]{2,80})`|\b[A-Za-z][A-Za-z0-9_./-]{2,}\b/gu)].map((match) => match[1] ?? match[0]);
    const uniqueTerms = new Map<string, number>();

    for (const candidate of candidates) {
        const normalized = candidate.replace(/^["'([{]+|["')\]}.,:;]+$/gu, "").trim();
        const lower = normalized.toLowerCase();
        if (
            normalized.length < 3
            || TARGETED_GREP_STOP_WORDS.has(lower)
            || /^\d+$/u.test(normalized)
        ) {
            continue;
        }
        const score = (/[A-Z_./-]/u.test(normalized) ? 2 : 1) + Math.min(3, Math.floor(normalized.length / 12));
        uniqueTerms.set(normalized, Math.max(uniqueTerms.get(normalized) ?? 0, score));
    }

    return [...uniqueTerms.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12)
        .map(([term]) => term);
};

const buildCodeGrepPattern = (subtask: string): string => {
    if (!subtask.includes(TARGETED_CONTEXT_MARKER)) {
        return DEFAULT_CODE_GREP_PATTERN;
    }
    const terms = extractTargetedTerms(subtask);
    if (terms.length === 0) {
        return DEFAULT_CODE_GREP_PATTERN;
    }
    return terms.map(escapeRegex).join("|");
};

const leadDelegator = async (state: WorkerState) => {
    return {
        workerKind: state.workerKind,
        status: WorkerStatus.WORKING,
        attempts: state.attempts ?? 0,
        escalationAttempts: state.escalationAttempts ?? 0,
        failureType: FailureType.NONE,
    };
};

const runWorkerPlan = async (state: WorkerState, plans: WorkerToolPlan[]) => {
    const rawOutputs: string[] = [];
    const producedArtifacts: Record<string, string> = {};
    const toolCalls: ToolCallRecord[] = [];

    try {
        for (const [index, plan] of plans.entries()) {
            const result = await openclawRpc(plan.tool, plan.args, {
                timeoutS: plan.tool === "shell_exec" ? 120 : 45,
                idempotencyKey: `${state.workerKind}-${state.attempts ?? 0}-${index}`,
                maxRetries: 1,
            });
            const exitCode = readExitCode(result);
            if (plan.tool === "shell_exec" && exitCode !== undefined && exitCode !== 0) {
                throw new Error(`shell_exec exited with code ${exitCode}: ${stringifyToolResult(result)}`);
            }

            const serialized = stringifyToolResult(result);
            const artifact = await storeArtifact(serialized);
            const artifactKey = `${plan.tool}-${index}`;

            rawOutputs.push(`## ${plan.tool}\n${serialized}`);
            producedArtifacts[artifactKey] = artifact;
            toolCalls.push({ tool: plan.tool, ok: true, artifact });
        }

        return {
            status: WorkerStatus.DONE,
            failureType: FailureType.NONE,
            attempts: (state.attempts ?? 0) + 1,
            rawToolOutput: rawOutputs.join("\n\n"),
            producedArtifacts,
            toolCalls,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedTool = plans[toolCalls.length]?.tool ?? "unknown";
        return {
            status: WorkerStatus.ESCALATING,
            failureType: classifyFailure(message),
            attempts: (state.attempts ?? 0) + 1,
            escalationQuery: message,
            rawToolOutput: rawOutputs.join("\n\n"),
            producedArtifacts,
            toolCalls: [...toolCalls, { tool: failedTool, ok: false, error: message }],
        };
    }
};

const codeExplorer = (state: WorkerState) => {
    const grepPattern = buildCodeGrepPattern(state.subtask);
    const plans: WorkerToolPlan[] = [
        {
            tool: "find_files",
            args: { path: ".", pattern: "src/**/*.ts", limit: 100 },
        },
        {
            tool: "grep_code",
            args: {
                path: ".",
                pattern: grepPattern,
                ignoreCase: false,
                limit: 80,
            },
        },
    ];
    return runWorkerPlan(state, plans);
};

const infraOps = (state: WorkerState) => {
    const command = parseInfraCommand(state.subtask);
    return runWorkerPlan(state, [{ tool: "shell_exec", args: { command, timeout: 120 } }]);
};

const webResearcher = (state: WorkerState) => {
    return runWorkerPlan(state, [{ tool: "web_lookup", args: { query: state.subtask } }]);
};

const smeOracle = async (state: WorkerState) => {
    const result = await callLlm(
        "frontier",
        SystemPrompts.smeOracle,
        state.escalationQuery,
        { maxTokens: 900, reasoningEffort: "high", thinking: "enabled" },
    );
    return {
        escalationResponse: result.content,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { frontierSme: usageFromLlm(result) },
    };
};

const humanGate = (state: WorkerState) => {
    // Environment failures (missing binary, permissions, gateway/timeout) need
    // out-of-band human resolution. A live HITL channel requires the swarm to be
    // compiled with a checkpointer and a resume loop in the caller; neither is
    // wired in this runtime, and calling `interrupt()` without a checkpointer
    // throws and crashes the whole run. Until that infrastructure exists, block
    // gracefully and surface actionable detail up through the firewall instead.
    const failure = state.failureType ?? FailureType.UNKNOWN;
    const reason = state.escalationQuery ?? "unknown environment error";
    return {
        status: WorkerStatus.BLOCKED,
        escalationResponse: `Manual resolution required (${failure}): ${reason}`,
    };
};

const workerCompress = async (state: WorkerState) => {
    const result = await callLlm(
        "firewall",
        SystemPrompts.workerCompress,
        state.rawToolOutput || JSON.stringify(state.toolCalls),
        { maxTokens: 1_200, responseFormat: "json_object", thinking: "disabled" },
    );
    return {
        workerSummary: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { firewall: usageFromLlm(result) },
    };
};

const delegateToWorker = (state: WorkerState): string => {
    const mapping: Record<WorkerKind, string> = {
        [WorkerKind.CODE_EXPLORER]: "codeExplorer",
        [WorkerKind.INFRA_OPS]: "infraOps",
        [WorkerKind.WEB_RESEARCHER]: "webResearcher",
    };
    return mapping[state.workerKind] ?? "codeExplorer";
};

const routeAfterWorker = (state: WorkerState): string => {
    if (state.status === WorkerStatus.DONE) {
        return "workerCompress";
    }
    if ((state.escalationAttempts ?? 0) >= MAX_ESCALATION_ATTEMPTS) {
        return "__blocked__";
    }
    if (state.failureType === FailureType.REASONING) {
        return "smeOracle";
    }
    return "humanGate";
};

const routeAfterSme = (state: WorkerState): string => {
    if (!state.escalationResponse) {
        return "__blocked__";
    }
    return delegateToWorker(state);
};

const routeAfterHuman = (state: WorkerState): string => {
    if (state.status === WorkerStatus.BLOCKED) {
        return "__blocked__";
    }
    return delegateToWorker(state);
};

export const buildSwarm = () => {
    const graph = new StateGraph(SwarmWorkerState)
        .addNode("leadDelegator", leadDelegator)
        .addNode("codeExplorer", codeExplorer)
        .addNode("infraOps", infraOps)
        .addNode("webResearcher", webResearcher)
        .addNode("smeOracle", smeOracle)
        .addNode("humanGate", humanGate)
        .addNode("workerCompress", workerCompress)
        .addEdge(START, "leadDelegator")
        .addConditionalEdges("leadDelegator", delegateToWorker, {
            codeExplorer: "codeExplorer",
            infraOps: "infraOps",
            webResearcher: "webResearcher",
        });

    const afterWorkerTargets = {
        smeOracle: "smeOracle",
        humanGate: "humanGate",
        workerCompress: "workerCompress",
        __blocked__: END,
    } as const;

    graph
        .addConditionalEdges("codeExplorer", routeAfterWorker, afterWorkerTargets)
        .addConditionalEdges("infraOps", routeAfterWorker, afterWorkerTargets)
        .addConditionalEdges("webResearcher", routeAfterWorker, afterWorkerTargets);

    const workerTargets = {
        codeExplorer: "codeExplorer",
        infraOps: "infraOps",
        webResearcher: "webResearcher",
        __blocked__: END,
    } as const;

    graph
        .addConditionalEdges("smeOracle", routeAfterSme, workerTargets)
        .addConditionalEdges("humanGate", routeAfterHuman, workerTargets)
        .addEdge("workerCompress", END);

    return graph.compile();
};
