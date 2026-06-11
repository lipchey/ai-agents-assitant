/* ModelRef values must stay byte-equal to the model-pricing.json keys. */
export const ModelRef = {
    CLAUDE_OPUS: "anthropic/claude-opus-4-8",
    CLAUDE_SONNET: "anthropic/claude-sonnet-4-6",
    GPT: "openai/gpt-5.5",
    DEEPSEEK_PRO: "deepseek/deepseek-v4-pro",
    DEEPSEEK_FLASH: "deepseek/deepseek-v4-flash",
} as const;

export type ModelRef = (typeof ModelRef)[keyof typeof ModelRef];

export const ModelProvider = {
    ANTHROPIC: "anthropic",
    DEEPSEEK: "deepseek",
    OPENAI: "openai",
    UNKNOWN: "unknown",
} as const;

export type ModelProvider = (typeof ModelProvider)[keyof typeof ModelProvider];

export const ModelRole = {
    ROUTER: "router",
    FRONTIER: "frontier",
    ARCHITECT: "architect",
    CODER: "coder",
    CRITIC: "critic",
    SME: "sme",
    WORKER: "worker",
    FIREWALL: "firewall",
} as const;

export type ModelRole = (typeof ModelRole)[keyof typeof ModelRole];

export const ChatRole = {
    SYSTEM: "system",
    USER: "user",
} as const;

export type ChatRole = (typeof ChatRole)[keyof typeof ChatRole];

export const ReasoningEffort = {
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    XHIGH: "xhigh",
    MAX: "max",
} as const;

export type ReasoningEffort = (typeof ReasoningEffort)[keyof typeof ReasoningEffort];

export const ThinkingMode = {
    ADAPTIVE: "adaptive",
    ENABLED: "enabled",
    DISABLED: "disabled",
} as const;

export type ThinkingMode = (typeof ThinkingMode)[keyof typeof ThinkingMode];

export const RESPONSE_FORMAT_JSON = "json_object" as const;

/* Current Anthropic API semantics for the direct transport: these models manage
   sampling internally and reject an explicit temperature/top_p. Matched by id
   prefix so dated snapshots (e.g. -20251001) are covered. */
export const ANTHROPIC_FIXED_SAMPLING_MODEL_IDS = ["claude-fable-5", "claude-opus-4-8", "claude-opus-4-7"] as const;

/* Fable 5 rejects an explicit thinking:"disabled"; the param must be omitted. */
export const ANTHROPIC_ALWAYS_THINKING_MODEL_IDS = ["claude-fable-5"] as const;

export const ModelTransport = {
    DIRECT: "direct",
    OPENCLAW: "openclaw",
} as const;

export type ModelTransport = (typeof ModelTransport)[keyof typeof ModelTransport];

/* Active-profile key threaded through LangGraph `configurable`, beside
   TOOL_REGISTRY_CONFIG_KEY / HITL_RESOLVER_CONFIG_KEY. */
export const PROFILE_CONFIG_KEY = "profile";

/* Profile loaded when none is selected; byte-replicates the pre-profile bindings. */
export const DEFAULT_PROFILE_NAME = "default";
