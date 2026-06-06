/* Provider cache-usage fields differ, so cost accounting normalizes them here. */
import fs from "node:fs/promises";
import path from "node:path";
import type { LlmUsage } from "../shared";
import type { ModelPricing, ProviderUsage } from "../types/tools";

let pricingCache: Promise<Record<string, ModelPricing>> | undefined;

export const loadPricing = (): Promise<Record<string, ModelPricing>> => {
    pricingCache ??= fs.readFile(path.join(process.cwd(), "src", "consts", "pricing", "model-pricing.json"), "utf8")
        .then((pricingFile) => JSON.parse(pricingFile) as Record<string, ModelPricing>)
        .catch(() => ({}));
    return pricingCache;
};

const usageNumber = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
};

const tokenCost = (tokens: number, per1M: number): number => (tokens / 1_000_000) * per1M;

export const calculateUsage = (usage: ProviderUsage, pricing: ModelPricing | undefined): LlmUsage => {
    const deepSeekCacheHitTokens = usageNumber(usage.prompt_cache_hit_tokens);
    const deepSeekCacheMissTokens = usageNumber(usage.prompt_cache_miss_tokens);
    const openAiCachedInputTokens = usageNumber(usage.prompt_tokens_details?.cached_tokens)
        ?? usageNumber(usage.input_tokens_details?.cached_tokens);
    const anthropicCacheReadTokens = usageNumber(usage.cache_read_input_tokens);
    const anthropicCacheWrite5mTokens = usageNumber(usage.cache_creation?.ephemeral_5m_input_tokens) ?? 0;
    const anthropicCacheWrite1hTokens = usageNumber(usage.cache_creation?.ephemeral_1h_input_tokens) ?? 0;
    const anthropicDetailedWriteTokens = anthropicCacheWrite5mTokens + anthropicCacheWrite1hTokens;
    const anthropicFlatWriteTokens = usageNumber(usage.cache_creation_input_tokens) ?? 0;
    const anthropicCacheWriteTokens = anthropicDetailedWriteTokens || anthropicFlatWriteTokens;
    const hasAnthropicCacheUsage = anthropicCacheReadTokens !== undefined || anthropicCacheWriteTokens > 0;
    const rawPromptTokens = usageNumber(usage.prompt_tokens);
    const rawInputTokens = usageNumber(usage.input_tokens);
    const uncachedInputTokens = usageNumber(usage.uncached_input_tokens);
    const rawTotalTokens = usageNumber(usage.total_tokens);

    const promptTokens = rawPromptTokens
        ?? rawInputTokens
        ?? uncachedInputTokens
        ?? (deepSeekCacheHitTokens ?? 0) + (deepSeekCacheMissTokens ?? 0);
    const outputTokens = usageNumber(usage.completion_tokens) ?? usageNumber(usage.output_tokens) ?? 0;
    const cachedInputTokens = deepSeekCacheHitTokens ?? openAiCachedInputTokens ?? anthropicCacheReadTokens ?? 0;
    const cacheWriteInputTokens = hasAnthropicCacheUsage ? anthropicCacheWriteTokens : 0;
    const anthropicRawInputTokens = rawInputTokens ?? rawPromptTokens ?? promptTokens;
    const anthropicRawInputIncludesCacheRead = rawPromptTokens !== undefined
        || openAiCachedInputTokens !== undefined
        || (
            rawInputTokens !== undefined
            && rawTotalTokens !== undefined
            && rawTotalTokens <= rawInputTokens + outputTokens
        );
    const anthropicCacheMissInputTokens = uncachedInputTokens
        ?? (
            anthropicRawInputIncludesCacheRead
                ? Math.max(0, anthropicRawInputTokens - cachedInputTokens)
                : anthropicRawInputTokens
        );
    const cacheMissInputTokens = deepSeekCacheMissTokens
        ?? (hasAnthropicCacheUsage ? anthropicCacheMissInputTokens : Math.max(0, promptTokens - cachedInputTokens));
    const inputTokens = hasAnthropicCacheUsage
        ? cacheMissInputTokens + cachedInputTokens + cacheWriteInputTokens
        : promptTokens;
    const computedTotalTokens = inputTokens + outputTokens;
    const tokens = hasAnthropicCacheUsage
        ? Math.max(rawTotalTokens ?? 0, computedTotalTokens)
        : rawTotalTokens ?? computedTotalTokens;

    if (!pricing) {
        return { tokens, cost: 0, inputTokens, outputTokens, cachedInputTokens, cacheMissInputTokens, cacheWriteInputTokens };
    }

    let inputCost: number;
    if (deepSeekCacheHitTokens !== undefined || deepSeekCacheMissTokens !== undefined) {
        const hitTokens = deepSeekCacheHitTokens ?? 0;
        const missTokens = deepSeekCacheMissTokens ?? Math.max(0, promptTokens - hitTokens);
        const unclassifiedTokens = Math.max(0, promptTokens - hitTokens - missTokens);
        inputCost = tokenCost(hitTokens, pricing.inputCacheHitPer1M ?? pricing.inputPer1M)
            + tokenCost(missTokens, pricing.inputCacheMissPer1M ?? pricing.inputPer1M)
            + tokenCost(unclassifiedTokens, pricing.inputPer1M);
    } else if (hasAnthropicCacheUsage) {
        const flatWriteRemainderTokens = Math.max(0, anthropicFlatWriteTokens - anthropicDetailedWriteTokens);
        inputCost = tokenCost(cacheMissInputTokens, pricing.inputPer1M)
            + tokenCost(cachedInputTokens, pricing.inputCacheHitPer1M ?? pricing.inputPer1M)
            + tokenCost(anthropicCacheWrite5mTokens, pricing.inputCacheWrite5mPer1M ?? pricing.inputCacheWritePer1M ?? pricing.inputPer1M)
            + tokenCost(anthropicCacheWrite1hTokens, pricing.inputCacheWrite1hPer1M ?? pricing.inputCacheWritePer1M ?? pricing.inputPer1M)
            + tokenCost(flatWriteRemainderTokens, pricing.inputCacheWritePer1M ?? pricing.inputCacheWrite5mPer1M ?? pricing.inputPer1M);
    } else if (cachedInputTokens > 0) {
        inputCost = tokenCost(cachedInputTokens, pricing.inputCacheHitPer1M ?? pricing.inputPer1M)
            + tokenCost(Math.max(0, promptTokens - cachedInputTokens), pricing.inputCacheMissPer1M ?? pricing.inputPer1M);
    } else {
        inputCost = tokenCost(promptTokens, pricing.inputPer1M);
    }

    return {
        tokens,
        cost: inputCost + tokenCost(outputTokens, pricing.outputPer1M),
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheMissInputTokens,
        cacheWriteInputTokens,
    };
};
