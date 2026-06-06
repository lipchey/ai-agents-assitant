// Token/cost usage accounting shared by graph state, swarm state, the LLM client,
// and node code. One definition of the usage shape and its merge logic, instead
// of the field list being re-typed in state.ts, swarm.ts, pricing.ts, and two
// usageFromLlm copies. Dependency-free so both `shared` and `tools` can use it.

// The fully-populated usage numbers returned by an LLM call / cost calculation.
export type LlmUsage = {
    tokens: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheMissInputTokens: number;
    cacheWriteInputTokens: number;
};

// The per-role usage record stored in state (numeric fields optional so partial
// updates merge cleanly).
export type UsageBreakdown = {
    cost: number;
    tokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    cacheMissInputTokens?: number;
    cacheWriteInputTokens?: number;
};

// Per-role usage totals. Keys are UsageKey values; left permissive (string) so
// the reducer and the telemetry print loop iterate without undefined-value
// friction. Construct entries with the UsageKey constants for typo safety.
export type UsageStats = Record<string, UsageBreakdown>;

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

// Project an LLM usage result onto the stored usage shape.
export const usageFromLlm = (result: LlmUsage): UsageBreakdown => ({
    cost: result.cost,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedInputTokens: result.cachedInputTokens,
    cacheMissInputTokens: result.cacheMissInputTokens,
    cacheWriteInputTokens: result.cacheWriteInputTokens,
});

// Reducer for the `usageStats` state field: sum per-role usage across updates.
export const mergeUsageStats = (
    left: UsageStats | undefined,
    right: UsageStats | undefined,
): UsageStats => {
    const result: UsageStats = { ...(left ?? {}) };
    for (const [key, value] of Object.entries(right ?? {})) {
        const current = result[key];
        result[key] = current ? mergeUsage(current, value) : { ...value };
    }
    return result;
};
