import { reasoningPrompts } from "./reasoning-prompts.ts";
import { workerPrompts } from "./worker-prompts.ts";

export { reasoning, utility, worker } from "./core.ts";
export { reasoningPrompts } from "./reasoning-prompts.ts";
export { workerPrompts } from "./worker-prompts.ts";

export const SystemPrompts = {
    ...reasoningPrompts,
    ...workerPrompts,
} as const;

export type SystemPromptKey = keyof typeof SystemPrompts;
