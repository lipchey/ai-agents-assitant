// Public barrel: the single source of truth for every LLM-calling node's system
// prompt. See prompts/core.ts for the two-tier (CORE / REASONING_CONTEXT /
// WORKER_CORE) composition design.
import { reasoningPrompts } from "./prompts/reasoning-prompts.js";
import { workerPrompts } from "./prompts/worker-prompts.js";

export const SystemPrompts = {
    ...reasoningPrompts,
    ...workerPrompts,
} as const;

export type SystemPromptKey = keyof typeof SystemPrompts;
