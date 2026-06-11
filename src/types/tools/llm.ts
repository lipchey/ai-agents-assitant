import type { ZodType } from "zod";
import type { LlmUsage } from "../usage.ts";
import type { ReasoningEffort, RESPONSE_FORMAT_JSON, ThinkingMode } from "../../consts";
import type { ProviderUsage } from "./pricing.ts";

export type ChatCompletionResponse = {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: ProviderUsage;
};

/* parsed is present only when a structuredSchema call was honored natively;
   parse sites prefer it and keep the text ladder as the universal fallback. */
export type LlmCallResult = LlmUsage & { content: string; parsed?: unknown };

export type LlmCallOptions = {
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
    responseFormat?: typeof RESPONSE_FORMAT_JSON;
    thinking?: ThinkingMode;
    structuredSchema?: ZodType;
};
