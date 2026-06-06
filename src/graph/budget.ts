/* Soft USD guard is separate from the hard loop caps in routing.ts. */
import type { GraphStateValue } from "./types.js";

const COST_BUDGET_SOFT_CEILING_RATIO = 0.95;
const COST_BUDGET_MIN_REMAINING_USD = 0.005;

export const PROJECTED_CONTEXT_REFETCH_CYCLE_USD = 0.08;
export const PROJECTED_STRONG_ARCHITECT_USD = 0.05;
export const PROJECTED_CODER_REVIEW_CYCLE_USD = 0.06;
export const PROJECTED_STRONG_CRITIC_USD = 0.05;
export const PROJECTED_SME_TIEBREAKER_USD = 0.05;

const readCostBudgetUsd = (state: GraphStateValue): number => {
    const budget = state.costBudgetUsd;
    return typeof budget === "number" && Number.isFinite(budget) && budget > 0
        ? budget
        : Number.POSITIVE_INFINITY;
};

export const isCostBudgetNear = (state: GraphStateValue, projectedCostUsd = 0): boolean => {
    const budget = readCostBudgetUsd(state);
    if (!Number.isFinite(budget)) {
        return false;
    }
    const actualCost = state.totalCost ?? 0;
    const softCeiling = budget * COST_BUDGET_SOFT_CEILING_RATIO;
    return actualCost + projectedCostUsd >= softCeiling
        || budget - actualCost <= COST_BUDGET_MIN_REMAINING_USD;
};

export const canSpendUsd = (state: GraphStateValue, projectedCostUsd: number): boolean =>
    !isCostBudgetNear(state, projectedCostUsd);
