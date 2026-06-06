import type { GraphComplexity } from "../../consts";

export type RouterDecision = {
    complexity: GraphComplexity;
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
