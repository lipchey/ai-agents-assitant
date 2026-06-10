/* Soft USD guard is separate from the hard loop caps in routing.ts. */
import { COST_BUDGET_MIN_REMAINING_USD, COST_BUDGET_SOFT_CEILING_RATIO } from "../consts";
import type { GraphStateValue } from "../state";

export {
    PROJECTED_CONTEXT_REFETCH_CYCLE_USD,
    PROJECTED_STRONG_ARCHITECT_USD,
    PROJECTED_CODER_REVIEW_CYCLE_USD,
    PROJECTED_STRONG_CRITIC_USD,
    PROJECTED_SME_TIEBREAKER_USD,
} from "../consts";

const readCostBudgetUsd = (state: GraphStateValue): number => {
    const budget = state.costBudgetUsd;
    return typeof budget === "number" && Number.isFinite(budget) && budget > 0 ? budget : Number.POSITIVE_INFINITY;
};

export const isCostBudgetNear = (state: GraphStateValue, projectedCostUsd = 0): boolean => {
    const budget = readCostBudgetUsd(state);
    if (!Number.isFinite(budget)) {
        return false;
    }
    const actualCost = state.totalCost ?? 0;
    const softCeiling = budget * COST_BUDGET_SOFT_CEILING_RATIO;
    return actualCost + projectedCostUsd >= softCeiling || budget - actualCost <= COST_BUDGET_MIN_REMAINING_USD;
};

export const canSpendUsd = (state: GraphStateValue, projectedCostUsd: number): boolean =>
    !isCostBudgetNear(state, projectedCostUsd);
