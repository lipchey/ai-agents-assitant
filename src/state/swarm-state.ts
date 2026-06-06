// Swarm sub-graph state: a single delegated subtask flowing through the lead
// delegator, a ReAct worker, optional SME/human escalation, and compression.
import { Annotation } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "../enums.js";
import { mergeUsageStats, type UsageStats } from "../shared/usage.js";
import { concatArrays, mergeDicts, sumNumbers } from "./reducers.js";

export type ToolCallRecord = {
    tool: string;
    ok: boolean;
    artifact?: string;
    error?: string;
};

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
