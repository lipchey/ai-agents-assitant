import { reasoningPrompts } from "./prompts/reasoning-prompts.ts";
import { workerPrompts } from "./prompts/worker-prompts.ts";

export const SystemPrompts = {
    ...reasoningPrompts,
    ...workerPrompts,
} as const;

export type { SystemPromptKey } from "./types/prompts.ts";
