import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { readProfile } from "../models";
import { reasoningPrompts, reasoningPromptsFor } from "./reasoning-prompts.ts";
import type { ReasoningPrompts } from "./reasoning-prompts.ts";
import { workerPrompts } from "./worker-prompts.ts";

export { DEFAULT_CASCADE_NOTE, reasoning, utility, worker } from "./core.ts";
export { reasoningPrompts, reasoningPromptsFor } from "./reasoning-prompts.ts";
export type { ReasoningPrompts } from "./reasoning-prompts.ts";
export { workerPrompts, WORKER_PROMPTS } from "./worker-prompts.ts";

export const SystemPrompts = {
    ...reasoningPrompts,
    ...workerPrompts,
} as const;

export type SystemPromptKey = keyof typeof SystemPrompts;

/* Graph-node accessor: reasoning anchors vary by the active profile's
   prompts.cascadeNote; worker/utility prompts are profile-independent. */
export const promptsForConfig = (config?: LangGraphRunnableConfig): ReasoningPrompts =>
    reasoningPromptsFor(readProfile(config).prompts?.cascadeNote);
