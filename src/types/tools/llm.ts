import type { LlmUsage } from "../usage.ts";
import type { ProviderUsage } from "./pricing.ts";

export type ChatCompletionResponse = {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: ProviderUsage;
};

export type LlmCallResult = LlmUsage & { content: string };

export type LlmCallOptions = {
    maxTokens?: number;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
    responseFormat?: "json_object";
    thinking?: "adaptive" | "enabled" | "disabled";
};
