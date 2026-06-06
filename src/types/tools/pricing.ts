export type ModelPricing = {
    inputPer1M: number;
    outputPer1M: number;
    inputCacheHitPer1M?: number;
    inputCacheMissPer1M?: number;
    inputCacheWritePer1M?: number;
    inputCacheWrite5mPer1M?: number;
    inputCacheWrite1hPer1M?: number;
};

export type ProviderUsage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    uncached_input_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
    };
};
