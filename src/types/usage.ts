import type { UsageKey } from "../consts/usage.ts";

export type LlmUsage = {
    tokens: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheMissInputTokens: number;
    cacheWriteInputTokens: number;
};

export type UsageBreakdown = {
    cost: number;
    tokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheMissInputTokens?: number;
    cacheWriteInputTokens?: number;
};

export type UsageStats = Partial<Record<UsageKey, UsageBreakdown>>;
