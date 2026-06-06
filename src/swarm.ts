import { END, START, StateGraph } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";
import { SwarmWorkerState, type ToolCallRecord } from "./state.js";
import { callLlm, openclawRpc, storeArtifact, type OpenClawRpcArgs } from "./tools/openclaw.js";

const MAX_ESCALATION_ATTEMPTS = 2;

type WorkerState = typeof SwarmWorkerState.State;

type WorkerToolPlan = {
    tool: string;
    args: OpenClawRpcArgs;
};

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
    const plans: WorkerToolPlan[] = [
        {
            tool: "find_files",
            args: { path: ".", pattern: "src/**/*.ts", limit: 100 },
        },
        {
            tool: "grep_code",
            args: {
                path: ".",
                pattern: "OpenClaw|openclawRpc|callLlm|StateGraph|Annotation",
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
    const { content, cost, tokens } = await callLlm(
        "sme",
        "You are a subject-matter expert. Return concise recovery advice for the worker.",
        state.escalationQuery,
    );
    return {
        escalationResponse: content,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { sme: { cost, tokens } },
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
    const { content, cost, tokens } = await callLlm(
        "firewall",
        [
            "Summarize raw tool output for a reasoning model.",
            "Preserve file paths, commands, exit statuses, errors, and artifact handles.",
            "Return compact JSON with keys: findings, evidence, risks, artifacts.",
        ].join(" "),
        state.rawToolOutput || JSON.stringify(state.toolCalls),
    );
    return {
        workerSummary: content,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { firewall: { cost, tokens } },
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
