// Main reasoning-graph state: the full lifecycle of a task from routing through
// swarm context, the debate chamber, guarded patch application, and verification.
import { Annotation } from "@langchain/langgraph";
import { DEFAULT_COST_BUDGET_USD } from "../constants.js";
import { WorkerStatus } from "../enums.js";
import { mergeUsageStats, type UsageStats } from "../shared/usage.js";
import { concatArrays, lastWriteWins, mergeDicts, sumNumbers } from "./reducers.js";

export type DebateEntry = {
    round: number;
    critique: string;
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

    // Guarded patch-application stage. OFF by default; when enabled, `applyPatches`
    // writes the coder's structured patch blocks to disk so `verify` tests the real
    // mutated tree. `patchBackups`/`patchCreatedFiles` capture pristine state for
    // rollback if verification ultimately fails.
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

    // Loop guards bounding the two reentrant cycles (context refetch, verify/fix)
    // independently of the USD budget so a misbehaving critic/verifier cannot burn
    // spend or trip the recursion limit. Last-write-wins with a 0 default so they
    // are safe to read in routers before any node sets them.
    contextFetches: Annotation<number>({
        reducer: lastWriteWins,
        default: () => 0,
    }),
    verifyAttempts: Annotation<number>({
        reducer: lastWriteWins,
        default: () => 0,
    }),
    // Pure patch-format retries (the coder produced a draft with no applicable
    // <<<PATCH>>> blocks). Separate from `verifyAttempts` so a formatting slip —
    // which does not change approved logic — never burns a real verify attempt.
    patchFormatRetries: Annotation<number>({
        reducer: lastWriteWins,
        default: () => 0,
    }),
    // Set when `applyPatches` bounced a draft back to the coder solely to fix patch
    // formatting; the post-coder router reads it to skip the full critic cycle.
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
