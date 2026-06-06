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
