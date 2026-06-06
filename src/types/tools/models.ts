import type { ModelProvider, ModelRef } from "../../consts";

export type { ModelProvider } from "../../consts";

export type ModelRouting = {
    modelRef: ModelRef;
    provider: ModelProvider;
    temperature?: number;
};
