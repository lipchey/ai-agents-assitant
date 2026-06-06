import type { LlmUsage } from "../usage.ts";
import type { ReasoningEffort, RESPONSE_FORMAT_JSON, ThinkingMode } from "../../consts";
import type { ProviderUsage } from "./pricing.ts";

export type ChatCompletionResponse = {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: ProviderUsage;
};

export type LlmCallResult = LlmUsage & { content: string };

export type LlmCallOptions = {
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
    responseFormat?: typeof RESPONSE_FORMAT_JSON;
    thinking?: ThinkingMode;
};
