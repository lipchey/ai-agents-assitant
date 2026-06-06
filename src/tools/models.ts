// Model routing: maps an abstract cost-cascade role to a concrete provider model
// reference, provider, and default temperature. This is the single place that
// decides which model backs each role.
import { ModelRef, ModelRole, OpenClawControl } from "../constants.js";

export type ModelProvider = "anthropic" | "deepseek" | "openai" | "unknown";

export type ModelRouting = {
    modelRef: ModelRef;
    provider: ModelProvider;
    temperature?: number;
};

// OpenClaw routing identifiers used by callLlm.
export const DEFAULT_OPENCLAW_MODEL = OpenClawControl.DEFAULT_MODEL;
// Agent whose `thinkingDefault: "adaptive"` reaches the provider runtime; used
// for Anthropic strong-reasoning calls.
export const STRONG_REASONING_AGENT_ID = OpenClawControl.STRONG_REASONING_AGENT_ID;

export const providerForModel = (modelRef: string): ModelProvider => {
    const provider = modelRef.split("/", 1)[0];
    return provider === "anthropic" || provider === "deepseek" || provider === "openai"
        ? provider
        : "unknown";
};

const isClaudeOpusModel = (modelRef: string): boolean => /^anthropic\/claude-opus-/u.test(modelRef);

// Claude Opus routes omit temperature (the provider rejects it alongside
// adaptive thinking), so drop it for Opus even when a default is given.
const route = (modelRef: ModelRef, temperature?: number): ModelRouting => ({
    modelRef,
    provider: providerForModel(modelRef),
    ...(!isClaudeOpusModel(modelRef) && temperature !== undefined ? { temperature } : {}),
});

const assertNeverRole = (role: never): never => {
    throw new Error(`Unhandled model role: ${String(role)}`);
};

export const modelForRole = (role: ModelRole): ModelRouting => {
    switch (role) {
        case ModelRole.ARCHITECT:
        case ModelRole.SME:
            return route(ModelRef.CLAUDE_OPUS, 0.2);
        case ModelRole.CODER:
            return route(ModelRef.CLAUDE_SONNET, 0.2);
        case ModelRole.CRITIC:
            return route(ModelRef.GPT, 0.1);
        case ModelRole.FRONTIER:
            return route(ModelRef.DEEPSEEK_PRO, 0.2);
        case ModelRole.FIREWALL:
        case ModelRole.ROUTER:
        case ModelRole.WORKER:
            // Swarm-layer execution planning (lead delegation + ReAct workers) is
            // deliberately cheap: tool selection is not deep reasoning, and the loop
            // may issue many calls, so it runs on the cheapest flash model at
            // temperature 0 for stable, repeatable tool decisions.
            return route(ModelRef.DEEPSEEK_FLASH, 0);
        default:
            return assertNeverRole(role);
    }
};
