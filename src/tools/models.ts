import { ModelRef, ModelRole } from "../consts/models.ts";
import { OpenClawControl } from "../consts/openclaw.ts";
import type { ModelProvider, ModelRouting } from "../types/tools/models.ts";

export type { ModelProvider, ModelRouting } from "../types/tools/models.ts";

export const DEFAULT_OPENCLAW_MODEL = OpenClawControl.DEFAULT_MODEL;
export const STRONG_REASONING_AGENT_ID = OpenClawControl.STRONG_REASONING_AGENT_ID;

export const providerForModel = (modelRef: string): ModelProvider => {
    const provider = modelRef.split("/", 1)[0];
    return provider === "anthropic" || provider === "deepseek" || provider === "openai"
        ? provider
        : "unknown";
};

const isClaudeOpusModel = (modelRef: string): boolean => /^anthropic\/claude-opus-/u.test(modelRef);

/* Claude Opus rejects temperature alongside adaptive thinking. */
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
            /* Tool planning can fan out, so keep it cheap and deterministic. */
            return route(ModelRef.DEEPSEEK_FLASH, 0);
        default:
            return assertNeverRole(role);
    }
};
