import { Annotation } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "../consts/worker.js";
import { mergeUsageStats, type UsageStats } from "../shared/usage.js";
import type { ToolCallRecord } from "../types/state/swarm.js";
import { concatArrays, mergeDicts, sumNumbers } from "./reducers.js";

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

export type SwarmWorkerStateValue = typeof SwarmWorkerState.State;
