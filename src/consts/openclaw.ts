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

export const DEFAULT_OPENCLAW_MODEL = OpenClawControl.DEFAULT_MODEL;
export const STRONG_REASONING_AGENT_ID = OpenClawControl.STRONG_REASONING_AGENT_ID;

/* Local gateway defaults mirror the development OpenClaw setup. */
export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";

/* OpenClaw RPC defaults are intentionally shorter than long verification calls. */
export const DEFAULT_TIMEOUT_S = 30;

/* Gateway startup captures enough logs to diagnose boot failures without flooding output. */
export const STARTUP_TIMEOUT_MS = 45_000;
export const GATEWAY_LOG_MAX_CHARS = 8_000;
export const GATEWAY_PROBE_TIMEOUT_MS = 2_000;
export const GATEWAY_STARTUP_POLL_INTERVAL_MS = 750;
export const GATEWAY_SHUTDOWN_GRACE_MS = 5_000;
