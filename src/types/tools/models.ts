import type { ModelRef } from "../consts/models.js";

export type ModelProvider = "anthropic" | "deepseek" | "openai" | "unknown";

export type ModelRouting = {
    modelRef: ModelRef;
    provider: ModelProvider;
    temperature?: number;
};
