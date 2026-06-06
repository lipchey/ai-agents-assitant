/* Gateway endpoints and agent ids are typo-sensitive runtime controls. */
export const OpenClawControl = {
    DEFAULT_MODEL: "openclaw/default",
    STRONG_REASONING_AGENT_ID: "strong-reasoning",
    DEFAULT_SESSION_KEY: "main",
    CHAT_COMPLETIONS_ENDPOINT: "/v1/chat/completions",
    TOOLS_INVOKE_ENDPOINT: "/tools/invoke",
    READY_ENDPOINT: "/readyz",
    HEALTH_ENDPOINT: "/healthz",
    MODELS_ENDPOINT: "/v1/models",
} as const;

export type OpenClawControl = (typeof OpenClawControl)[keyof typeof OpenClawControl];
