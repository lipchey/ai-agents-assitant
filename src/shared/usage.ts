import type { UsageKey } from "../consts";
import type { LlmUsage, UsageBreakdown, UsageStats } from "../types";

export type { LlmUsage, UsageBreakdown, UsageStats } from "../types";

export const emptyUsage = (): UsageBreakdown => ({
    cost: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheMissInputTokens: 0,
    cacheWriteInputTokens: 0,
});

export const mergeUsage = (left: UsageBreakdown, right: UsageBreakdown): UsageBreakdown => ({
    cost: left.cost + right.cost,
    tokens: left.tokens + right.tokens,
    inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0),
    cachedInputTokens: (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0),
    cacheMissInputTokens: (left.cacheMissInputTokens ?? 0) + (right.cacheMissInputTokens ?? 0),
    cacheWriteInputTokens: (left.cacheWriteInputTokens ?? 0) + (right.cacheWriteInputTokens ?? 0),
});

export const usageFromLlm = (result: LlmUsage): UsageBreakdown => ({
    cost: result.cost,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedInputTokens: result.cachedInputTokens,
    cacheMissInputTokens: result.cacheMissInputTokens,
    cacheWriteInputTokens: result.cacheWriteInputTokens,
});

export const mergeUsageStats = (left: UsageStats | undefined, right: UsageStats | undefined): UsageStats => {
    const result: UsageStats = { ...(left ?? {}) };
    for (const [key, value] of Object.entries(right ?? {}) as Array<[UsageKey, UsageBreakdown]>) {
        const current = result[key];
        result[key] = current ? mergeUsage(current, value) : { ...value };
    }
    return result;
};
