import { Annotation } from "@langchain/langgraph";
import { DEFAULT_COST_BUDGET_USD } from "../consts/tuning.ts";
import { WorkerStatus } from "../consts/worker.ts";
import { mergeUsageStats, type UsageStats } from "../shared/usage.ts";
import type { DebateEntry } from "../types/state/graph.ts";
import { concatArrays, lastWriteWins, mergeDicts, sumNumbers } from "./reducers.ts";

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
        reducer: lastWriteWins,
        default: () => false,
    }),
    strongEscalationReason: Annotation<string>,
    criticConfidence: Annotation<number>,
    strongCriticRequired: Annotation<boolean>({
        reducer: lastWriteWins,
        default: () => false,
    }),
    criticEscalationReason: Annotation<string>,
    verificationPassed: Annotation<boolean>,
    verificationReport: Annotation<string>,

    /* Separate backups from created files so failed guarded runs roll back cleanly. */
    patchApplicationEnabled: Annotation<boolean>({
        reducer: lastWriteWins,
        default: () => false,
    }),
    patchApplied: Annotation<boolean>({
        reducer: lastWriteWins,
        default: () => false,
    }),
    patchApplicationFailed: Annotation<boolean>({
        reducer: lastWriteWins,
        default: () => false,
    }),
    appliedFiles: Annotation<string[]>({
        reducer: concatArrays,
        default: () => [],
    }),
    patchBackups: Annotation<Record<string, string>>({
        reducer: mergeDicts,
        default: () => ({}),
    }),
    patchCreatedFiles: Annotation<string[]>({
        reducer: concatArrays,
        default: () => [],
    }),
    patchReport: Annotation<string>,
    costBudgetUsd: Annotation<number>({
        reducer: lastWriteWins,
        default: () => DEFAULT_COST_BUDGET_USD,
    }),
    finalAnswer: Annotation<string>,

    /* Hard loop counters are independent of the soft USD budget. */
    contextFetches: Annotation<number>({
        reducer: lastWriteWins,
        default: () => 0,
    }),
    verifyAttempts: Annotation<number>({
        reducer: lastWriteWins,
        default: () => 0,
    }),
    /* Patch-format retries do not burn verifyAttempts because the tree did not change. */
    patchFormatRetries: Annotation<number>({
        reducer: lastWriteWins,
        default: () => 0,
    }),
    /* Skips critique after a retry that only fixes patch delimiters. */
    awaitingPatchReformat: Annotation<boolean>({
        reducer: lastWriteWins,
        default: () => false,
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
