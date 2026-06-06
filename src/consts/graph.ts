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

/* Route token, not a node name, so conditional edges can target blocked explicitly. */
export const SWARM_BLOCKED_ROUTE = "__blocked__";
