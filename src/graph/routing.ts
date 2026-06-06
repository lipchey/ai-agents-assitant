// Conditional-edge routers for the main graph. These enforce the hard loop caps
// (context refetch, debate, verify, patch-format) that bound the reentrant cycles
// independently of the soft USD budget guard in budget.ts.
import { MainNode } from "../constants.js";
import {
    PROJECTED_CODER_REVIEW_CYCLE_USD,
    PROJECTED_CONTEXT_REFETCH_CYCLE_USD,
    PROJECTED_SME_TIEBREAKER_USD,
    PROJECTED_STRONG_ARCHITECT_USD,
    PROJECTED_STRONG_CRITIC_USD,
    canSpendUsd,
    isCostBudgetNear,
} from "./budget.js";
import type { GraphStateValue } from "./types.js";

const MAX_DEBATE_ITERATIONS = 4;
// The swarm runs once on the primary route, so 2 total fetches permit exactly one
// debate-driven refetch before we stop paying for another swarm + Opus architect
// pass each loop.
const MAX_CONTEXT_FETCHES = 2;
const MAX_VERIFY_ATTEMPTS = 2;
// Bounds pure patch-format retries independently of MAX_VERIFY_ATTEMPTS: a reminder
// to emit <<<PATCH>>> blocks lands on the first retry; beyond this the coder cannot
// produce applicable blocks, so finalize instead of paying for more coder passes.
const MAX_PATCH_FORMAT_RETRIES = 2;

export const routeByComplexity = (state: GraphStateValue): string => {
    if (state.complexity === "trivial") {
        return MainNode.DIRECT_RESPONDER;
    }
    if (state.complexity === "pure_reasoning") {
        return MainNode.FRONTIER_ARCHITECT;
    }
    return MainNode.SWARM;
};

export const routeAfterFrontierArchitect = (state: GraphStateValue): string => {
    if (isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD)) {
        return MainNode.FINALIZE;
    }
    if (state.complexity === "pure_reasoning") {
        return state.strongEscalationRequired && canSpendUsd(state, PROJECTED_STRONG_ARCHITECT_USD)
            ? MainNode.CLAUDE_ARCHITECT
            : MainNode.FINALIZE;
    }
    if (state.strongEscalationRequired && canSpendUsd(state, PROJECTED_STRONG_ARCHITECT_USD + PROJECTED_CODER_REVIEW_CYCLE_USD)) {
        return MainNode.CLAUDE_ARCHITECT;
    }
    return MainNode.CLAUDE_CODER;
};

export const routeAfterClaudeArchitect = (state: GraphStateValue): string =>
    state.complexity === "pure_reasoning" ? MainNode.FINALIZE : MainNode.CLAUDE_CODER;

export const routeDebate = (state: GraphStateValue): string => {
    // Budget exhausted, or the critic approved: stop debating and apply patches.
    // Consensus wins over a late "needs more context" so we don't re-enter the swarm
    // after the draft is already approved.
    if (isCostBudgetNear(state) || state.consensusReached) {
        return MainNode.APPLY_PATCHES;
    }
    // Refetch context only under the hard cap; otherwise a critic that keeps asking
    // for context loops swarm → firewall → architect → coder → critic indefinitely.
    if (
        state.needsMoreContext
        && (state.contextFetches ?? 0) < MAX_CONTEXT_FETCHES
        && canSpendUsd(state, PROJECTED_CONTEXT_REFETCH_CYCLE_USD)
    ) {
        return MainNode.SWARM;
    }
    if (state.debateIterations >= MAX_DEBATE_ITERATIONS) {
        return canSpendUsd(state, PROJECTED_SME_TIEBREAKER_USD) ? MainNode.SME_TIEBREAKER : MainNode.APPLY_PATCHES;
    }
    return canSpendUsd(state, PROJECTED_CODER_REVIEW_CYCLE_USD) ? MainNode.CLAUDE_CODER : MainNode.APPLY_PATCHES;
};

export const routeAfterFrontierCritic = (state: GraphStateValue): string => {
    if (state.strongCriticRequired && canSpendUsd(state, PROJECTED_STRONG_CRITIC_USD)) {
        return MainNode.OPENAI_CRITIC;
    }
    return routeDebate(state);
};

export const routeAfterApplyPatches = (state: GraphStateValue): string => {
    if (!state.patchApplicationFailed) {
        return MainNode.VERIFY;
    }
    if (isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD) || (state.patchFormatRetries ?? 0) >= MAX_PATCH_FORMAT_RETRIES) {
        return MainNode.FINALIZE;
    }
    return MainNode.CLAUDE_CODER;
};

export const routeAfterCoder = (state: GraphStateValue): string => {
    // A pure patch-format retry does not change the logic the critics approved, so
    // re-emit straight into applyPatches instead of paying for another critic pass.
    return state.awaitingPatchReformat ? MainNode.APPLY_PATCHES : MainNode.FRONTIER_CRITIC;
};

export const routeAfterVerify = (state: GraphStateValue): string => {
    // Stop the verify/fix cycle once verified, over budget, or at the attempt cap,
    // so a failing typecheck or malformed patch cannot spin indefinitely.
    if (
        state.verificationPassed
        || isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD)
        || (state.verifyAttempts ?? 0) >= MAX_VERIFY_ATTEMPTS
    ) {
        return MainNode.FINALIZE;
    }
    return MainNode.CLAUDE_CODER;
};
