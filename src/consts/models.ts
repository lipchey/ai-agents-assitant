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
