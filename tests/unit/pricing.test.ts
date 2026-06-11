/*
 * Characterization tests for calculateUsage (src/tools/pricing.ts).
 * These pin CURRENT behavior before the R1 refactor: every expected token
 * count and USD cost below is derived BY HAND from the per-MTok rates in
 * src/consts/pricing/model-pricing.json and the function's actual math
 * (tokenCost(tokens, per1M) = tokens / 1_000_000 * per1M). Integer token
 * fields are asserted exactly; floating USD costs use toBeCloseTo at 10
 * decimals (far tighter than any rate change, looser than float noise).
 */
import { describe, expect, it } from "vitest";
import { calculateUsage } from "../../src/tools/pricing.ts";
import type { ModelPricing, ProviderUsage } from "../../src/types/tools/pricing.ts";

/* Rates mirror model-pricing.json exactly; calculateUsage takes pricing as a
 * parameter, so the unit under test never reads the JSON itself. */
const deepSeekProPricing: ModelPricing = {
    inputPer1M: 0.435,
    inputCacheHitPer1M: 0.003625,
    inputCacheMissPer1M: 0.435,
    outputPer1M: 0.87,
};

const openAiPricing: ModelPricing = {
    inputPer1M: 5,
    inputCacheHitPer1M: 0.5,
    inputCacheMissPer1M: 5,
    outputPer1M: 30,
};

const anthropicOpusPricing: ModelPricing = {
    inputPer1M: 5,
    inputCacheHitPer1M: 0.5,
    inputCacheMissPer1M: 5,
    inputCacheWritePer1M: 6.25,
    inputCacheWrite5mPer1M: 6.25,
    inputCacheWrite1hPer1M: 10,
    outputPer1M: 25,
};

const anthropicSonnetPricing: ModelPricing = {
    inputPer1M: 3,
    inputCacheHitPer1M: 0.3,
    inputCacheMissPer1M: 3,
    inputCacheWritePer1M: 3.75,
    inputCacheWrite5mPer1M: 3.75,
    inputCacheWrite1hPer1M: 6,
    outputPer1M: 15,
};

describe("calculateUsage", () => {
    it("prices a DeepSeek cache-hit/cache-miss split", () => {
        const usage: ProviderUsage = {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
            prompt_cache_hit_tokens: 200,
            prompt_cache_miss_tokens: 800,
        };

        const result = calculateUsage(usage, deepSeekProPricing);

        /*
         * inputCost = 200/1e6*0.003625 + 800/1e6*0.435 + 0
         *           = 0.000000725 + 0.000348 = 0.000348725
         * cost = inputCost + 500/1e6*0.87 (0.000435) = 0.000783725
         */
        expect(result.tokens).toBe(1500);
        expect(result.inputTokens).toBe(1000);
        expect(result.outputTokens).toBe(500);
        expect(result.cachedInputTokens).toBe(200);
        expect(result.cacheMissInputTokens).toBe(800);
        expect(result.cacheWriteInputTokens).toBe(0);
        expect(result.cost).toBeCloseTo(0.000783725, 10);
    });

    it("prices an OpenAI cached-input prompt", () => {
        const usage: ProviderUsage = {
            prompt_tokens: 1000,
            completion_tokens: 400,
            total_tokens: 1400,
            prompt_tokens_details: { cached_tokens: 300 },
        };

        const result = calculateUsage(usage, openAiPricing);

        /*
         * cachedInputTokens = 300, cacheMissInputTokens = 1000 - 300 = 700.
         * inputCost = 300/1e6*0.5 (0.00015) + 700/1e6*5 (0.0035) = 0.00365
         * cost = inputCost + 400/1e6*30 (0.012) = 0.01565
         */
        expect(result.tokens).toBe(1400);
        expect(result.inputTokens).toBe(1000);
        expect(result.outputTokens).toBe(400);
        expect(result.cachedInputTokens).toBe(300);
        expect(result.cacheMissInputTokens).toBe(700);
        expect(result.cacheWriteInputTokens).toBe(0);
        expect(result.cost).toBeCloseTo(0.01565, 10);
    });

    it("normalizes Anthropic cache read plus 5m/1h cache writes", () => {
        const usage: ProviderUsage = {
            input_tokens: 500,
            output_tokens: 200,
            cache_read_input_tokens: 1000,
            cache_creation: {
                ephemeral_5m_input_tokens: 300,
                ephemeral_1h_input_tokens: 100,
            },
        };

        const result = calculateUsage(usage, anthropicOpusPricing);

        /*
         * input_tokens (500) is treated as cache-miss; cache read 1000;
         * cache write = 5m(300) + 1h(100) = 400.
         * inputTokens = 500 + 1000 + 400 = 1900; tokens = 1900 + 200 = 2100.
         * inputCost = 500/1e6*5 (0.0025) + 1000/1e6*0.5 (0.0005)
         *           + 300/1e6*6.25 (0.001875) + 100/1e6*10 (0.001) = 0.005875
         * cost = inputCost + 200/1e6*25 (0.005) = 0.010875
         */
        expect(result.tokens).toBe(2100);
        expect(result.inputTokens).toBe(1900);
        expect(result.outputTokens).toBe(200);
        expect(result.cachedInputTokens).toBe(1000);
        expect(result.cacheMissInputTokens).toBe(500);
        expect(result.cacheWriteInputTokens).toBe(400);
        expect(result.cost).toBeCloseTo(0.010875, 10);
    });

    it("normalizes a flat Anthropic cache_creation_input_tokens write", () => {
        const usage: ProviderUsage = {
            input_tokens: 500,
            output_tokens: 200,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 400,
        };

        const result = calculateUsage(usage, anthropicSonnetPricing);

        /*
         * No 5m/1h breakdown, so the flat 400 write bills at inputCacheWritePer1M.
         * inputTokens = 500 + 1000 + 400 = 1900; tokens = 2100.
         * inputCost = 500/1e6*3 (0.0015) + 1000/1e6*0.3 (0.0003)
         *           + 400/1e6*3.75 (0.0015) = 0.0033
         * cost = inputCost + 200/1e6*15 (0.003) = 0.0063
         */
        expect(result.tokens).toBe(2100);
        expect(result.inputTokens).toBe(1900);
        expect(result.outputTokens).toBe(200);
        expect(result.cachedInputTokens).toBe(1000);
        expect(result.cacheMissInputTokens).toBe(500);
        expect(result.cacheWriteInputTokens).toBe(400);
        expect(result.cost).toBeCloseTo(0.0063, 10);
    });

    it("returns an all-zero breakdown for empty usage with known pricing", () => {
        const usage: ProviderUsage = {};

        const result = calculateUsage(usage, openAiPricing);

        expect(result.tokens).toBe(0);
        expect(result.cost).toBe(0);
        expect(result.inputTokens).toBe(0);
        expect(result.outputTokens).toBe(0);
        expect(result.cachedInputTokens).toBe(0);
        expect(result.cacheMissInputTokens).toBe(0);
        expect(result.cacheWriteInputTokens).toBe(0);
    });

    /* R3 direct-transport shapes: the direct provider feeds the raw SDK usage
     * object straight into calculateUsage; one case per provider family pins
     * the new bare-id pricing entries (claude-fable-5, gpt-5.5, deepseek-v4-*). */
    it("prices a direct Anthropic response (claude-fable-5 rates)", () => {
        const fablePricing: ModelPricing = {
            inputPer1M: 10,
            inputCacheHitPer1M: 1,
            inputCacheMissPer1M: 10,
            inputCacheWritePer1M: 12.5,
            inputCacheWrite5mPer1M: 12.5,
            inputCacheWrite1hPer1M: 20,
            outputPer1M: 50,
        };
        const usage: ProviderUsage = {
            input_tokens: 800,
            output_tokens: 300,
            cache_read_input_tokens: 1200,
            cache_creation: { ephemeral_5m_input_tokens: 500 },
        };

        const result = calculateUsage(usage, fablePricing);

        /*
         * input_tokens (800) is cache-miss; read 1200; 5m write 500.
         * inputTokens = 800 + 1200 + 500 = 2500; tokens = 2500 + 300 = 2800.
         * inputCost = 800/1e6*10 (0.008) + 1200/1e6*1 (0.0012)
         *           + 500/1e6*12.5 (0.00625) = 0.01545
         * cost = inputCost + 300/1e6*50 (0.015) = 0.03045
         */
        expect(result.tokens).toBe(2800);
        expect(result.inputTokens).toBe(2500);
        expect(result.outputTokens).toBe(300);
        expect(result.cachedInputTokens).toBe(1200);
        expect(result.cacheMissInputTokens).toBe(800);
        expect(result.cacheWriteInputTokens).toBe(500);
        expect(result.cost).toBeCloseTo(0.03045, 10);
    });

    it("prices a direct OpenAI response (gpt-5.5 rates)", () => {
        const gptDirectPricing: ModelPricing = {
            inputPer1M: 5,
            inputCacheHitPer1M: 0.5,
            inputCacheMissPer1M: 5,
            outputPer1M: 30,
        };
        const usage: ProviderUsage = {
            prompt_tokens: 2000,
            completion_tokens: 600,
            total_tokens: 2600,
            prompt_tokens_details: { cached_tokens: 1500 },
        };

        const result = calculateUsage(usage, gptDirectPricing);

        /*
         * cached 1500, miss 500.
         * inputCost = 1500/1e6*0.5 (0.00075) + 500/1e6*5 (0.0025) = 0.00325
         * cost = inputCost + 600/1e6*30 (0.018) = 0.02125
         */
        expect(result.tokens).toBe(2600);
        expect(result.inputTokens).toBe(2000);
        expect(result.outputTokens).toBe(600);
        expect(result.cachedInputTokens).toBe(1500);
        expect(result.cacheMissInputTokens).toBe(500);
        expect(result.cacheWriteInputTokens).toBe(0);
        expect(result.cost).toBeCloseTo(0.02125, 10);
    });

    it("prices a direct DeepSeek response (deepseek-v4-flash rates)", () => {
        const flashDirectPricing: ModelPricing = {
            inputPer1M: 0.14,
            inputCacheHitPer1M: 0.0028,
            inputCacheMissPer1M: 0.14,
            outputPer1M: 0.28,
        };
        const usage: ProviderUsage = {
            prompt_tokens: 1200,
            completion_tokens: 400,
            total_tokens: 1600,
            prompt_cache_hit_tokens: 900,
            prompt_cache_miss_tokens: 300,
        };

        const result = calculateUsage(usage, flashDirectPricing);

        /*
         * inputCost = 900/1e6*0.0028 (0.00000252) + 300/1e6*0.14 (0.000042)
         *           = 0.00004452
         * cost = inputCost + 400/1e6*0.28 (0.000112) = 0.00015652
         */
        expect(result.tokens).toBe(1600);
        expect(result.inputTokens).toBe(1200);
        expect(result.outputTokens).toBe(400);
        expect(result.cachedInputTokens).toBe(900);
        expect(result.cacheMissInputTokens).toBe(300);
        expect(result.cacheWriteInputTokens).toBe(0);
        expect(result.cost).toBeCloseTo(0.00015652, 10);
    });

    it("falls back to zero cost while still normalizing tokens for an unknown model", () => {
        const usage: ProviderUsage = {
            prompt_tokens: 1000,
            completion_tokens: 400,
            total_tokens: 1400,
            prompt_tokens_details: { cached_tokens: 300 },
        };

        const result = calculateUsage(usage, undefined);

        /* Unknown model => pricing undefined => early return, cost 0, tokens still split. */
        expect(result.cost).toBe(0);
        expect(result.tokens).toBe(1400);
        expect(result.inputTokens).toBe(1000);
        expect(result.outputTokens).toBe(400);
        expect(result.cachedInputTokens).toBe(300);
        expect(result.cacheMissInputTokens).toBe(700);
        expect(result.cacheWriteInputTokens).toBe(0);
    });
});
