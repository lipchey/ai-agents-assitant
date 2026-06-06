export const EnvVar = {
    COST_BUDGET_USD: "AGENT_COST_BUDGET_USD",
    HITL: "AGENT_HITL",
    APPLY_PATCHES: "AGENT_APPLY_PATCHES",
    GATEWAY_URL: "OPENCLAW_GATEWAY_URL",
    BASE_URL: "OPENCLAW_BASE_URL",
    GATEWAY_TOKEN: "OPENCLAW_GATEWAY_TOKEN",
    CONFIG_PATH: "OPENCLAW_CONFIG_PATH",
    STATE_DIR: "OPENCLAW_STATE_DIR",
} as const;

const TRUTHY_ENV_PATTERN = /^(1|true|yes|on)$/iu;

export const isTruthyEnv = (value: string | undefined): boolean =>
    TRUTHY_ENV_PATTERN.test(value?.trim() ?? "");
