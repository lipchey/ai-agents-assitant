// Centralized scalar constants for the whole framework.
//
// Every tool name, model reference, model role, graph node name, telemetry key,
// tool status, and env-var name lives here exactly once. Inline string/number
// literals for these are forbidden (a typo'd node name or usageStats key fails
// silently at runtime instead of at compile time). Each `as const` object is
// paired with a same-named union type so a value can be used both as a constant
// and as a precise type.

// --- Pseudo-tool / gateway-tool names ---------------------------------------
export const ToolName = {
    FIND_FILES: "find_files",
    GREP_CODE: "grep_code",
    AST_READ: "ast_read",
    SHELL_EXEC: "shell_exec",
    WEB_LOOKUP: "web_lookup",
    RUN_TESTS: "run_tests",
    TAVILY_SEARCH: "tavily_search",
    WEB_SEARCH: "web_search",
} as const;
export type ToolName = (typeof ToolName)[keyof typeof ToolName];

// --- Model references (MUST stay byte-equal to the keys in pricing.json) -----
export const ModelRef = {
    CLAUDE_OPUS: "anthropic/claude-opus-4-8",
    CLAUDE_SONNET: "anthropic/claude-sonnet-4-6",
    GPT: "openai/gpt-5.5",
    DEEPSEEK_PRO: "deepseek/deepseek-v4-pro",
    DEEPSEEK_FLASH: "deepseek/deepseek-v4-flash",
} as const;
export type ModelRef = (typeof ModelRef)[keyof typeof ModelRef];

// --- Model roles (the cost cascade). `callLlm` is typed by this union. -------
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

// --- OpenClaw control identifiers -------------------------------------------
// Gateway endpoints, agent/session ids, and transport model ids are just as
// typo-sensitive as node/tool names: a misspelling silently routes to the wrong
// Gateway behavior or endpoint.
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

// --- Main reasoning-graph node names -----------------------------------------
export const MainNode = {
    COMPLEXITY_ROUTER: "complexityRouter",
    DIRECT_RESPONDER: "directResponder",
    SWARM: "swarm",
    FIREWALL: "firewall",
    FRONTIER_ARCHITECT: "frontierArchitect",
    CLAUDE_ARCHITECT: "claudeArchitect",
    CLAUDE_CODER: "claudeCoder",
    FRONTIER_CRITIC: "frontierCritic",
    OPENAI_CRITIC: "openaiCritic",
    SME_TIEBREAKER: "smeTiebreaker",
    APPLY_PATCHES: "applyPatches",
    VERIFY: "verify",
    FINALIZE: "finalize",
} as const;
export type MainNode = (typeof MainNode)[keyof typeof MainNode];

// --- Swarm sub-graph node names ----------------------------------------------
export const SwarmNode = {
    LEAD_DELEGATOR: "leadDelegator",
    CODE_EXPLORER: "codeExplorer",
    INFRA_OPS: "infraOps",
    WEB_RESEARCHER: "webResearcher",
    SME_ORACLE: "smeOracle",
    HUMAN_GATE: "humanGate",
    WORKER_COMPRESS: "workerCompress",
    BLOCKED: "blocked",
} as const;
export type SwarmNode = (typeof SwarmNode)[keyof typeof SwarmNode];

// Internal route token used by swarm conditional edges to reach the `blocked`
// terminal node; intentionally distinct from the node name itself.
export const SWARM_BLOCKED_ROUTE = "__blocked__";

// --- usageStats telemetry keys -----------------------------------------------
export const UsageKey = {
    ROUTER: "router",
    DIRECT: "direct",
    FRONTIER_ARCHITECT: "frontierArchitect",
    ARCHITECT: "architect",
    CODER: "coder",
    FRONTIER_CRITIC: "frontierCritic",
    CRITIC: "critic",
    SME: "sme",
    LEAD_DELEGATOR: "leadDelegator",
    CODE_EXPLORER: "codeExplorer",
    INFRA_OPS: "infraOps",
    WEB_RESEARCHER: "webResearcher",
    FRONTIER_SME: "frontierSme",
    FIREWALL: "firewall",
} as const;
export type UsageKey = (typeof UsageKey)[keyof typeof UsageKey];

// --- Local-process tool statuses (returned by runLocalProcess) ---------------
export const ToolStatus = {
    COMPLETED: "completed",
    FAILED: "failed",
    TIMED_OUT: "timed_out",
} as const;
export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];

// --- Environment variable names ----------------------------------------------
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
export type EnvVar = (typeof EnvVar)[keyof typeof EnvVar];

// --- LLM request shape -------------------------------------------------------
export const RESPONSE_FORMAT_JSON = "json_object" as const;

// --- Shared tuning thresholds ------------------------------------------------
// Confidence at/above which a frontier role is trusted without strong-model
// escalation. Mirrored in the frontierArchitect/frontierCritic prompt copy.
export const CONFIDENCE_ESCALATION_THRESHOLD = 0.72;

// Default per-run USD budget when none is supplied via env / graph input.
export const DEFAULT_COST_BUDGET_USD = 1;

// Objective verification command (also the default for the run_tests pseudo-tool).
// Must be a member of SAFE_DIRECT_EXEC_COMMANDS in tools/local-tools.ts.
export const VERIFY_TYPECHECK_COMMAND = "npm run typecheck";

// --- Web search failover (Tavily primary, DuckDuckGo fallback) ---------------
// Label used when the generic web_search result does not report its own provider
// id; keep aligned with tools.web.search.provider in openclaw.config.json5.
export const FALLBACK_PROVIDER_LABEL = "duckduckgo";
export const WEB_SEARCH_MAX_RESULTS = 8;

// Matches the values treated as an enabled boolean flag in env vars.
const TRUTHY_ENV_PATTERN = /^(1|true|yes|on)$/iu;

export const isTruthyEnv = (value: string | undefined): boolean =>
    TRUTHY_ENV_PATTERN.test(value?.trim() ?? "");
