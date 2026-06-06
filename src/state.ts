import { Annotation } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";

export type UsageBreakdown = {
    cost: number;
    tokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheMissInputTokens?: number;
    cacheWriteInputTokens?: number;
};

export type UsageStats = Record<string, UsageBreakdown>;

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
                inputTokens: (current.inputTokens ?? 0) + (value.inputTokens ?? 0),
                outputTokens: (current.outputTokens ?? 0) + (value.outputTokens ?? 0),
                cachedInputTokens: (current.cachedInputTokens ?? 0) + (value.cachedInputTokens ?? 0),
                cacheMissInputTokens: (current.cacheMissInputTokens ?? 0) + (value.cacheMissInputTokens ?? 0),
                cacheWriteInputTokens: (current.cacheWriteInputTokens ?? 0) + (value.cacheWriteInputTokens ?? 0),
            }
            : { ...value };
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
    frontierDraft: Annotation<string>,
    frontierConfidence: Annotation<number>,
    strongEscalationRequired: Annotation<boolean>({
        reducer: (_left, right) => right,
        default: () => false,
    }),
    strongEscalationReason: Annotation<string>,
    criticConfidence: Annotation<number>,
    strongCriticRequired: Annotation<boolean>({
        reducer: (_left, right) => right,
        default: () => false,
    }),
    criticEscalationReason: Annotation<string>,
    verificationPassed: Annotation<boolean>,
    verificationReport: Annotation<string>,
    costBudgetUsd: Annotation<number>({
        reducer: (_left, right) => right,
        default: () => 1,
    }),
    finalAnswer: Annotation<string>,

    // Loop guards. These bound the two reentrant cycles (context refetch and
    // verify/fix) independently of the USD cost budget so a misbehaving
    // critic/verifier cannot burn frontier-model spend or trip the graph
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
