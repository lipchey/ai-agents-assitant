import { END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";
import { SwarmWorkerState } from "./state.js";
import { callLlm, openclawRpc, storeArtifact, OpenClawError } from "./tools/openclaw.js";

const MAX_ESCALATION_ATTEMPTS = 2;

// Nodes
const leadDelegator = async (state: typeof SwarmWorkerState.State) => {
    return {
        status: WorkerStatus.WORKING,
        attempts: 0,
        escalationAttempts: 0,
        failureType: FailureType.NONE,
    };
};

const _runWorker = async (state: typeof SwarmWorkerState.State, tool: string) => {
    if (state.status === WorkerStatus.ESCALATING && state.escalationResponse) {
        // apply advice
    }

    try {
        const result = await openclawRpc(tool, { subtask: state.subtask });
        const handle = await storeArtifact(result.raw || "");
        return {
            status: WorkerStatus.DONE,
            failureType: FailureType.NONE,
            attempts: (state.attempts || 0) + 1,
            producedArtifacts: { [tool]: handle },
            toolCalls: [{ tool, ok: true }],
        };
    } catch (e: any) {
        const ft = FailureType.REASONING; // stub logic
        const essence: string = e && e.message ? String(e.message) : "Unknown error"; 
        return {
            status: WorkerStatus.ESCALATING,
            failureType: ft,
            attempts: (state.attempts || 0) + 1,
            escalationQuery: essence,
            toolCalls: [{ tool, ok: false }],
        };
    }
};

const codeExplorer = (state: typeof SwarmWorkerState.State) => _runWorker(state, "ast_read");
const infraOps = (state: typeof SwarmWorkerState.State) => _runWorker(state, "shell_exec");
const webResearcher = (state: typeof SwarmWorkerState.State) => _runWorker(state, "web_lookup");

const smeOracle = async (state: typeof SwarmWorkerState.State) => {
    const { content, cost, tokens } = await callLlm("sme", "You are a subject-matter expert.", state.escalationQuery || "");
    return {
        escalationResponse: content,
        escalationAttempts: (state.escalationAttempts || 0) + 1,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "sme": { cost, tokens } }
    };
};

const humanGate = (state: typeof SwarmWorkerState.State) => {
    const decision: any = interrupt({ reason: state.failureType, query: state.escalationQuery });
    if (decision?.resolved) {
        return { status: WorkerStatus.WORKING, escalationResponse: decision.fix };
    }
    return { status: WorkerStatus.BLOCKED };
};

const workerCompress = async (state: typeof SwarmWorkerState.State) => {
    const { content, cost, tokens } = await callLlm("firewall", "Summarize for a reasoning model, JSON.", state.rawToolOutput || JSON.stringify(state.toolCalls));
    return { 
        workerSummary: content,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "firewall": { cost, tokens } }
    };
};

// Routing
const delegateToWorker = (state: typeof SwarmWorkerState.State): string => {
    const mapping: Record<string, string> = {
        [WorkerKind.CODE_EXPLORER]: "codeExplorer",
        [WorkerKind.INFRA_OPS]: "infraOps",
        [WorkerKind.WEB_RESEARCHER]: "webResearcher",
    };
    return mapping[state.workerKind as string] || "codeExplorer";
};

const routeAfterWorker = (state: typeof SwarmWorkerState.State): string => {
    if (state.status === WorkerStatus.DONE) return "workerCompress";
    if ((state.escalationAttempts || 0) >= MAX_ESCALATION_ATTEMPTS) return "__blocked__";
    if (state.failureType === FailureType.REASONING) return "smeOracle";
    return "humanGate";
};

const routeAfterSme = (state: typeof SwarmWorkerState.State): string => {
    if (!state.escalationResponse) return "__blocked__";
    return delegateToWorker(state);
};

const routeAfterHuman = (state: typeof SwarmWorkerState.State): string => {
    if (state.status === WorkerStatus.BLOCKED) return "__blocked__";
    return delegateToWorker(state);
};

// Assembly
export const buildSwarm = () => {
    const g = new StateGraph(SwarmWorkerState)
        .addNode("leadDelegator", leadDelegator)
        .addNode("codeExplorer", codeExplorer)
        .addNode("infraOps", infraOps)
        .addNode("webResearcher", webResearcher)
        .addNode("smeOracle", smeOracle)
        .addNode("humanGate", humanGate)
        .addNode("workerCompress", workerCompress)
        .addEdge(START, "leadDelegator")
        .addConditionalEdges("leadDelegator", delegateToWorker as any, {
            "codeExplorer": "codeExplorer",
            "infraOps": "infraOps",
            "webResearcher": "webResearcher"
        } as any);

    const afterWorkerTargets: Record<string, string> = {
        "smeOracle": "smeOracle",
        "humanGate": "humanGate",
        "workerCompress": "workerCompress",
        "__blocked__": END
    };

    g.addConditionalEdges("codeExplorer", routeAfterWorker as any, afterWorkerTargets as any)
     .addConditionalEdges("infraOps", routeAfterWorker as any, afterWorkerTargets as any)
     .addConditionalEdges("webResearcher", routeAfterWorker as any, afterWorkerTargets as any);

    const workerTargets: Record<string, string> = {
        "codeExplorer": "codeExplorer",
        "infraOps": "infraOps",
        "webResearcher": "webResearcher",
        "__blocked__": END
    };
    g.addConditionalEdges("smeOracle", routeAfterSme as any, workerTargets as any)
     .addConditionalEdges("humanGate", routeAfterHuman as any, workerTargets as any)
     .addEdge("workerCompress", END);

    return g.compile();
};
