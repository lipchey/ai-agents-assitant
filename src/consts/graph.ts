export const GraphComplexity = {
    TRIVIAL: "trivial",
    TOOL_COMPLEX: "tool_complex",
    PURE_REASONING: "pure_reasoning",
} as const;

export type GraphComplexity = (typeof GraphComplexity)[keyof typeof GraphComplexity];

const GRAPH_COMPLEXITY_VALUES = new Set<string>(Object.values(GraphComplexity));

export const isGraphComplexity = (value: unknown): value is GraphComplexity =>
    typeof value === "string" && GRAPH_COMPLEXITY_VALUES.has(value);

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

/* Route token, not a node name, so conditional edges can target blocked explicitly. */
export const SWARM_BLOCKED_ROUTE = "__blocked__";

/* Keep these high-risk signals aligned with the architect/critic prompt criteria. */
export const STRONG_ESCALATION_SIGNALS = [
    /\bsecurity|authentication|authorization|authz|authn|crypto|encrypt|secret|token|permission\b/iu,
    /\bpayment|billing|invoice|pci|hipaa|gdpr|privacy|compliance|legal\b/iu,
    /\bproduction|prod|migration|database|schema|data loss|destructive|delete|rollback\b/iu,
    /\bconcurrency|distributed|race condition|deadlock|consistency|transaction\b/iu,
    /\bmulti-agent|orchestration|autonomous|human-in-the-loop|hitl|checkpointer\b/iu,
] as const;

/* Refetch term extraction ignores generic debate/repository vocabulary. */
export const CONTEXT_TERM_STOP_WORDS = new Set([
    "about",
    "after",
    "agent",
    "because",
    "before",
    "check",
    "code",
    "context",
    "critique",
    "current",
    "draft",
    "evidence",
    "fetch",
    "find",
    "frontier",
    "implementation",
    "latest",
    "missing",
    "more",
    "needs",
    "original",
    "project",
    "reason",
    "repository",
    "request",
    "search",
    "should",
    "state",
    "subtask",
    "summary",
    "targeted",
    "task",
    "that",
    "this",
    "true",
    "what",
    "where",
]);
