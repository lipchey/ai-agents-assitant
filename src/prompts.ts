import { reasoningPrompts } from "./prompts/reasoning-prompts.js";
import { workerPrompts } from "./prompts/worker-prompts.js";

export const SystemPrompts = {
    ...reasoningPrompts,
    ...workerPrompts,
} as const;

export type { SystemPromptKey } from "./types/prompts.js";
