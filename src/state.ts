import { Annotation } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";

export type UsageStats = Record<string, { cost: number; tokens: number }>;

export type DebateEntry = {
    round: number;
    critique: string;
};

export type ToolCallRecord = {
    tool: string;
    ok: boolean;
    artifact?: string;
    error?: string;
};

const mergeDicts = (
    left: Record<string, string> | undefined,
    right: Record<string, string> | undefined,
): Record<string, string> => {
    return { ...(left ?? {}), ...(right ?? {}) };
};

const concatArrays = <T>(left: T[] | undefined, right: T[] | undefined): T[] => {
    return [...(left ?? []), ...(right ?? [])];
};

const sumNumbers = (left: number | undefined, right: number | undefined): number => {
    return (left ?? 0) + (right ?? 0);
};

const mergeUsageStats = (
    left: UsageStats | undefined,
    right: UsageStats | undefined,
): UsageStats => {
    const result: UsageStats = { ...(left ?? {}) };
    for (const [key, value] of Object.entries(right ?? {})) {
        const current = result[key];
        result[key] = current
            ? {
                cost: current.cost + value.cost,
                tokens: current.tokens + value.tokens,
            }
            : { cost: value.cost, tokens: value.tokens };
    }
    return result;
};

export const GraphState = Annotation.Root({
    originalTask: Annotation<string>,
    complexity: Annotation<"trivial" | "tool_complex" | "pure_reasoning">,
    routeConfidence: Annotation<number>,
    compressedContext: Annotation<string>,
    swarmSummary: Annotation<string>,
    swarmStatus: Annotation<WorkerStatus>,
    artifactIndex: Annotation<Record<string, string>>({
        reducer: mergeDicts,
        default: () => ({}),
    }),
    architectureSpec: Annotation<string>,
    currentDraft: Annotation<string>,
    bestDraft: Annotation<string>,
    debateThread: Annotation<DebateEntry[]>({
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

    // Loop guards. These bound the two reentrant cycles (context refetch and
    // verify/fix) independently of the abstract tokenBudget so a misbehaving
    // critic/verifier cannot burn frontier-model tokens or trip the graph
    // recursion limit. Last-write-wins with an explicit default of 0 so they
    // are safe to read in routers before any node has set them.
    contextFetches: Annotation<number>({
        reducer: (_left, right) => right,
        default: () => 0,
    }),
    verifyAttempts: Annotation<number>({
        reducer: (_left, right) => right,
        default: () => 0,
    }),

    totalCost: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0,
    }),
    totalTokens: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0,
    }),
    usageStats: Annotation<UsageStats>({
        reducer: mergeUsageStats,
        default: () => ({}),
    }),
});

export const SwarmWorkerState = Annotation.Root({
    subtask: Annotation<string>,
    workerKind: Annotation<WorkerKind>,
    rawToolOutput: Annotation<string>,
    toolCalls: Annotation<ToolCallRecord[]>({
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

    totalCost: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0,
    }),
    totalTokens: Annotation<number>({
        reducer: sumNumbers,
        default: () => 0,
    }),
    usageStats: Annotation<UsageStats>({
        reducer: mergeUsageStats,
        default: () => ({}),
    }),
});
