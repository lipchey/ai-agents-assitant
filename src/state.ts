import { Annotation } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";

// Utility to merge dictionaries
const mergeDicts = (left: Record<string, string> | undefined, right: Record<string, string> | undefined) => {
    return { ...(left || {}), ...(right || {}) };
};

// Utility to concat arrays
const concatArrays = (left: any[] | undefined, right: any[] | undefined) => {
    return [...(left || []), ...(right || [])];
};

// Utility to sum numbers
const sumNumbers = (left: number | undefined, right: number | undefined) => {
    return (left || 0) + (right || 0);
};

// Utility to merge usage stats
const mergeUsageStats = (
    left: Record<string, { cost: number; tokens: number }> | undefined, 
    right: Record<string, { cost: number; tokens: number }> | undefined
) => {
    const res = { ...(left || {}) };
    for (const [key, val] of Object.entries(right || {})) {
        if (!res[key]) {
            res[key] = { cost: val.cost, tokens: val.tokens };
        } else {
            res[key] = {
                cost: res[key].cost + val.cost,
                tokens: res[key].tokens + val.tokens
            };
        }
    }
    return res;
};

export const GraphState = Annotation.Root({
    originalTask: Annotation<string>,
    complexity: Annotation<"trivial" | "tool_complex" | "pure_reasoning">,
    routeConfidence: Annotation<number>,
    compressedContext: Annotation<string>,
    artifactIndex: Annotation<Record<string, string>>({
        reducer: mergeDicts,
        default: () => ({}),
    }),
    architectureSpec: Annotation<string>,
    currentDraft: Annotation<string>,
    bestDraft: Annotation<string>,
    debateThread: Annotation<Array<Record<string, any>>>({
        reducer: concatArrays,
        default: () => [],
    }),
    debateSummary: Annotation<string>,
    debateIterations: Annotation<number>,
    consensusReached: Annotation<boolean>,
    needsMoreContext: Annotation<boolean>,
    verificationPassed: Annotation<boolean>,
    verificationReport: Annotation<string>,
    tokenBudget: Annotation<number>,
    finalAnswer: Annotation<string>,
    
    // Telemetry fields
    totalCost: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0
    }),
    totalTokens: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0
    }),
    usageStats: Annotation<Record<string, { cost: number; tokens: number }>>({
        reducer: mergeUsageStats,
        default: () => ({})
    })
});

export const SwarmWorkerState = Annotation.Root({
    subtask: Annotation<string>,
    workerKind: Annotation<WorkerKind>,
    rawToolOutput: Annotation<string>,
    toolCalls: Annotation<Array<Record<string, any>>>({
        reducer: concatArrays,
        default: () => [],
    }),
    attempts: Annotation<number>,
    status: Annotation<WorkerStatus>,
    failureType: Annotation<FailureType>,
    escalationQuery: Annotation<string>,
    escalationResponse: Annotation<string>,
    escalationAttempts: Annotation<number>,
    workerSummary: Annotation<string>,
    producedArtifacts: Annotation<Record<string, string>>({
        reducer: mergeDicts,
        default: () => ({}),
    }),
    
    // Telemetry fields
    totalCost: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0
    }),
    totalTokens: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0
    }),
    usageStats: Annotation<Record<string, { cost: number; tokens: number }>>({
        reducer: mergeUsageStats,
        default: () => ({})
    })
});
