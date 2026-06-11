import {
    GraphComplexity,
    MainNode,
    PROJECTED_CODER_REVIEW_CYCLE_USD,
    PROJECTED_CONTEXT_REFETCH_CYCLE_USD,
    PROJECTED_SME_TIEBREAKER_USD,
    PROJECTED_STRONG_ARCHITECT_USD,
    PROJECTED_STRONG_CRITIC_USD,
} from "../consts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { readProfile, resolveTuning } from "../models";
import { canSpendUsd, isCostBudgetNear } from "./budget.ts";
import type { GraphStateValue } from "../state";

export const routeByComplexity = (state: GraphStateValue): string => {
    if (state.complexity === GraphComplexity.TRIVIAL) {
        return MainNode.DIRECT_RESPONDER;
    }
    if (state.complexity === GraphComplexity.PURE_REASONING) {
        return MainNode.FRONTIER_ARCHITECT;
    }
    return MainNode.SWARM;
};

export const routeAfterFrontierArchitect = (state: GraphStateValue): string => {
    if (isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD)) {
        return MainNode.FINALIZE;
    }
    if (state.complexity === GraphComplexity.PURE_REASONING) {
        return state.strongEscalationRequired && canSpendUsd(state, PROJECTED_STRONG_ARCHITECT_USD)
            ? MainNode.CLAUDE_ARCHITECT
            : MainNode.FINALIZE;
    }
    if (
        state.strongEscalationRequired &&
        canSpendUsd(state, PROJECTED_STRONG_ARCHITECT_USD + PROJECTED_CODER_REVIEW_CYCLE_USD)
    ) {
        return MainNode.CLAUDE_ARCHITECT;
    }
    return MainNode.CLAUDE_CODER;
};

export const routeAfterClaudeArchitect = (state: GraphStateValue): string =>
    state.complexity === GraphComplexity.PURE_REASONING ? MainNode.FINALIZE : MainNode.CLAUDE_CODER;

export const routeDebate = (state: GraphStateValue, config?: LangGraphRunnableConfig): string => {
    const tuning = resolveTuning(readProfile(config));
    /* Consensus wins over a late needsMoreContext so an approved draft does not refetch. */
    if (isCostBudgetNear(state) || state.consensusReached) {
        return MainNode.APPLY_PATCHES;
    }
    /* Hard cap stops a critic from creating an unbounded context-refetch loop. */
    if (
        state.needsMoreContext &&
        (state.contextFetches ?? 0) < tuning.maxContextFetches &&
        canSpendUsd(state, PROJECTED_CONTEXT_REFETCH_CYCLE_USD)
    ) {
        return MainNode.SWARM;
    }
    if (state.debateIterations >= tuning.maxDebateIterations) {
        return canSpendUsd(state, PROJECTED_SME_TIEBREAKER_USD) ? MainNode.SME_TIEBREAKER : MainNode.APPLY_PATCHES;
    }
    return canSpendUsd(state, PROJECTED_CODER_REVIEW_CYCLE_USD) ? MainNode.CLAUDE_CODER : MainNode.APPLY_PATCHES;
};

export const routeAfterFrontierCritic = (state: GraphStateValue, config?: LangGraphRunnableConfig): string => {
    if (state.strongCriticRequired && canSpendUsd(state, PROJECTED_STRONG_CRITIC_USD)) {
        return MainNode.OPENAI_CRITIC;
    }
    return routeDebate(state, config);
};

export const routeAfterApplyPatches = (state: GraphStateValue, config?: LangGraphRunnableConfig): string => {
    if (!state.patchApplicationFailed) {
        return MainNode.VERIFY;
    }
    if (
        isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD) ||
        (state.patchFormatRetries ?? 0) >= resolveTuning(readProfile(config)).maxPatchFormatRetries
    ) {
        return MainNode.FINALIZE;
    }
    return MainNode.CLAUDE_CODER;
};

export const routeAfterCoder = (state: GraphStateValue): string => {
    /* Patch-format retries reuse approved logic instead of paying for another critique. */
    return state.awaitingPatchReformat ? MainNode.APPLY_PATCHES : MainNode.FRONTIER_CRITIC;
};

export const routeAfterVerify = (state: GraphStateValue, config?: LangGraphRunnableConfig): string => {
    /* Verified, over budget, or capped attempts all terminate the verify/fix loop. */
    if (
        state.verificationPassed ||
        isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD) ||
        (state.verifyAttempts ?? 0) >= resolveTuning(readProfile(config)).maxVerifyAttempts
    ) {
        return MainNode.FINALIZE;
    }
    return MainNode.CLAUDE_CODER;
};
