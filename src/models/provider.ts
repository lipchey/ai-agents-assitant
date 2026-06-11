/* ChatProvider seam (spec §3.3): every LLM call flows through one of these
   implementations. The invariant is the seam, not the message type: providers
   return RAW provider usage plus the pricing key, and the callLlm shim keeps
   cost accounting in exactly one place (calculateUsage + pricingKey). */
import type { ZodType } from "zod";
import type { ModelRole, ModelTransport } from "../consts";
import type { ProviderUsage } from "../types/tools";
import type { ModelBinding, ModelParams } from "./profile.ts";
import type { RetryAttempt } from "./retry.ts";

export type ChatCallOptions = ModelParams & {
    /* R5 wires native structured outputs; the openclaw transport always ignores it. */
    structuredSchema?: ZodType;
    /* Anthropic cache_control breakpoint on the system prompt (direct transport only). */
    cacheSystemPrompt?: boolean;
    /* Transient-error retry budget; the shim threads profile tuning.llmMaxRetries. */
    maxRetries?: number;
};

export type ChatResult = {
    text: string;
    /* Validated structured output when structuredSchema was honored (R5). */
    parsed?: unknown;
    /* Raw provider usage; callLlm normalizes and prices it in one place. */
    usage: ProviderUsage;
    /* model-pricing.json key used for the cost lookup. */
    pricingKey: string;
};

/* Providers report retries outward (the role/model context lives at the call,
   not in the provider instance); the shim turns these into structured logs. */
export type ChatRetryContext = {
    role: ModelRole;
    model: string;
    transport: ModelTransport;
};

export type ChatRetryListener = (info: RetryAttempt, context: ChatRetryContext) => void;

export interface ChatProvider {
    readonly kind: ModelTransport;
    call(
        role: ModelRole,
        binding: ModelBinding,
        system: string,
        user: string,
        options?: ChatCallOptions,
    ): Promise<ChatResult>;
}

/* Assistant content arrives as a plain string or an array of text-bearing parts
   (gateway chat completions and LangChain message blocks share this shape). */
export const chatContentToString = (content: unknown): string => {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }
                if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
                    return part.text;
                }
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    return content === null || content === undefined ? "" : String(content);
};
