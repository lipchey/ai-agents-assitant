export type RouterDecision = {
    complexity: "trivial" | "tool_complex" | "pure_reasoning";
    routeConfidence: number;
};

export type CriticDecision = {
    consensus: boolean;
    needsMoreContext: boolean;
    critique: string;
};

export type FrontierArchitectureDecision = {
    architectureSpec: string;
    confidence: number;
    escalateToStrong: boolean;
    escalationReason: string;
};

export type FrontierCriticDecision = CriticDecision & {
    confidence: number;
    requiresStrongCritic: boolean;
    escalationReason: string;
};
