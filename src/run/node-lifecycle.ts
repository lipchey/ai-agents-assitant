import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { getLogger } from "../logging";
import { asRecord, mergeUsageStats, readNumber } from "../shared";
import type { UsageStats } from "../shared";
import { readRunContext } from "./run-context.ts";

const withRunId = (fields: Record<string, unknown>, runId: string | undefined): Record<string, unknown> =>
    runId === undefined ? fields : { ...fields, runId };

const sumUsageStatsField = (usageStats: UsageStats, field: "cost" | "tokens"): number => {
    let total = 0;
    for (const entry of Object.values(usageStats)) {
        if (entry) {
            total += entry[field];
        }
    }
    return total;
};

/* A node update is a reducer delta (totalCost/totalTokens summed, usageStats
   merged). totalCost/totalTokens are authoritative when finite; otherwise the
   delta is reconstructed from the per-role usageStats entries. */
const readNodeDelta = (update: unknown): { costUsd: number; tokens: number; usageStats: UsageStats } => {
    const record = asRecord(update);
    if (!record) {
        return { costUsd: 0, tokens: 0, usageStats: {} };
    }
    /* One controlled narrowing of the usageStats slot, guarded by asRecord. */
    const usageStats: UsageStats = asRecord(record.usageStats) ? (record.usageStats as UsageStats) : {};
    const costUsd = readNumber(record.totalCost) ?? sumUsageStatsField(usageStats, "cost");
    const tokens = readNumber(record.totalTokens) ?? sumUsageStatsField(usageStats, "tokens");
    return { costUsd, tokens, usageStats };
};

export const wrapNode = <TState, TUpdate>(
    node: string,
    fn: (state: TState, config?: LangGraphRunnableConfig) => TUpdate | Promise<TUpdate>,
): ((state: TState, config?: LangGraphRunnableConfig) => Promise<TUpdate>) => {
    return async (state: TState, config?: LangGraphRunnableConfig): Promise<TUpdate> => {
        const logger = getLogger().child({ module: "graph" });
        const runContext = readRunContext(config);
        const runId = runContext?.runId;
        logger.debug("Node started.", withRunId({ node }, runId));
        const startedAtMs = Date.now();
        try {
            const update = await fn(state, config);
            const durationMs = Date.now() - startedAtMs;
            const { costUsd, tokens, usageStats } = readNodeDelta(update);
            if (runContext) {
                runContext.visits.push({ node, durationMs, costUsd });
                runContext.usage.totalCostUsd += costUsd;
                runContext.usage.totalTokens += tokens;
                runContext.usage.usageStats = mergeUsageStats(runContext.usage.usageStats, usageStats);
            }
            logger.info("Node finished.", withRunId({ node, durationMs, costDeltaUsd: costUsd }, runId));
            return update;
        } catch (error) {
            const durationMs = Date.now() - startedAtMs;
            if (runContext) {
                runContext.visits.push({ node, durationMs, costUsd: 0 });
            }
            logger.error("Node failed.", withRunId({ node, durationMs, error }, runId));
            throw error;
        }
    };
};
