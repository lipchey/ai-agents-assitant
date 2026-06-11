/*
 * Characterization tests for the conditional-edge routers in src/graph/routing.ts.
 * They pin the CURRENT routing behavior before the R1 refactor: one case per
 * reachable branch of every exported route function, asserting the exact MainNode
 * returned today. Node names are compared to the MainNode consts, never to string
 * literals.
 *
 * Budget arithmetic reference (see src/graph/budget.ts + src/consts/tuning.ts):
 * with costBudgetUsd = 1 the soft ceiling is 1 * 0.95 = 0.95 and the min-remaining
 * floor is 0.005. A fixture is "budget healthy" at totalCost 0 and "budget near"
 * at totalCost 1 (zero remaining). The magic totals 0.87 and 0.93 sit just under
 * the soft ceiling so the first isCostBudgetNear gate passes while a larger
 * projected-cost canSpendUsd gate fails, isolating the can-not-spend fall-throughs.
 */
import { describe, expect, it } from "vitest";
import {
    routeAfterApplyPatches,
    routeAfterClaudeArchitect,
    routeAfterCoder,
    routeAfterFrontierArchitect,
    routeAfterFrontierCritic,
    routeAfterVerify,
    routeByComplexity,
    routeDebate,
} from "../../src/graph/routing.ts";
import { GraphComplexity, MainNode } from "../../src/consts/graph.ts";
import {
    MAX_CONTEXT_FETCHES,
    MAX_DEBATE_ITERATIONS,
    MAX_PATCH_FORMAT_RETRIES,
    MAX_VERIFY_ATTEMPTS,
} from "../../src/consts/tuning.ts";
import { WorkerStatus } from "../../src/consts/worker.ts";
import type { GraphStateValue } from "../../src/state/graph-state.ts";

const baseState = (): GraphStateValue => ({
    originalTask: "",
    complexity: GraphComplexity.TOOL_COMPLEX,
    routeConfidence: 1,
    compressedContext: "",
    swarmSummary: "",
    swarmStatus: WorkerStatus.PENDING,
    artifactIndex: {},
    architectureSpec: "",
    currentDraft: "",
    bestDraft: "",
    debateThread: [],
    debateSummary: "",
    debateIterations: 0,
    consensusReached: false,
    needsMoreContext: false,
    frontierDraft: "",
    frontierConfidence: 1,
    strongEscalationRequired: false,
    strongEscalationReason: "",
    criticConfidence: 1,
    strongCriticRequired: false,
    criticEscalationReason: "",
    verificationPassed: false,
    verificationReport: "",
    patchApplicationEnabled: false,
    patchApplied: false,
    patchApplicationFailed: false,
    appliedFiles: [],
    patchBackups: {},
    patchCreatedFiles: [],
    patchReport: "",
    costBudgetUsd: 1,
    finalAnswer: "",
    contextFetches: 0,
    verifyAttempts: 0,
    patchFormatRetries: 0,
    awaitingPatchReformat: false,
    totalCost: 0,
    totalTokens: 0,
    usageStats: {},
});

const makeState = (overrides: Partial<GraphStateValue> = {}): GraphStateValue => ({
    ...baseState(),
    ...overrides,
});

describe("routeByComplexity", () => {
    it("routes trivial work to the direct responder", () => {
        expect(routeByComplexity(makeState({ complexity: GraphComplexity.TRIVIAL }))).toBe(MainNode.DIRECT_RESPONDER);
    });

    it("routes pure reasoning to the frontier architect", () => {
        expect(routeByComplexity(makeState({ complexity: GraphComplexity.PURE_REASONING }))).toBe(
            MainNode.FRONTIER_ARCHITECT,
        );
    });

    it("routes tool-complex work to the swarm", () => {
        expect(routeByComplexity(makeState({ complexity: GraphComplexity.TOOL_COMPLEX }))).toBe(MainNode.SWARM);
    });
});

describe("routeAfterFrontierArchitect", () => {
    it("finalizes when the budget is near", () => {
        expect(routeAfterFrontierArchitect(makeState({ totalCost: 1 }))).toBe(MainNode.FINALIZE);
    });

    it("escalates pure reasoning to the claude architect when escalation is required and affordable", () => {
        expect(
            routeAfterFrontierArchitect(
                makeState({ complexity: GraphComplexity.PURE_REASONING, strongEscalationRequired: true }),
            ),
        ).toBe(MainNode.CLAUDE_ARCHITECT);
    });

    it("finalizes pure reasoning when no escalation is required", () => {
        expect(
            routeAfterFrontierArchitect(
                makeState({ complexity: GraphComplexity.PURE_REASONING, strongEscalationRequired: false }),
            ),
        ).toBe(MainNode.FINALIZE);
    });

    it("escalates tool-complex work to the claude architect when escalation is required and affordable", () => {
        expect(
            routeAfterFrontierArchitect(
                makeState({ complexity: GraphComplexity.TOOL_COMPLEX, strongEscalationRequired: true }),
            ),
        ).toBe(MainNode.CLAUDE_ARCHITECT);
    });

    it("falls back to the claude coder when tool-complex escalation is required but the combined cycle is unaffordable", () => {
        expect(
            routeAfterFrontierArchitect(
                makeState({
                    complexity: GraphComplexity.TOOL_COMPLEX,
                    strongEscalationRequired: true,
                    totalCost: 0.87,
                }),
            ),
        ).toBe(MainNode.CLAUDE_CODER);
    });

    it("sends tool-complex work to the claude coder when no escalation is required", () => {
        expect(
            routeAfterFrontierArchitect(
                makeState({ complexity: GraphComplexity.TOOL_COMPLEX, strongEscalationRequired: false }),
            ),
        ).toBe(MainNode.CLAUDE_CODER);
    });
});

describe("routeAfterClaudeArchitect", () => {
    it("finalizes pure reasoning", () => {
        expect(routeAfterClaudeArchitect(makeState({ complexity: GraphComplexity.PURE_REASONING }))).toBe(
            MainNode.FINALIZE,
        );
    });

    it("hands tool-complex work to the claude coder", () => {
        expect(routeAfterClaudeArchitect(makeState({ complexity: GraphComplexity.TOOL_COMPLEX }))).toBe(
            MainNode.CLAUDE_CODER,
        );
    });
});

describe("routeDebate", () => {
    it("applies patches when consensus is reached", () => {
        expect(routeDebate(makeState({ consensusReached: true }))).toBe(MainNode.APPLY_PATCHES);
    });

    it("applies patches when the budget is near", () => {
        expect(routeDebate(makeState({ totalCost: 1 }))).toBe(MainNode.APPLY_PATCHES);
    });

    it("refetches via the swarm when more context is needed under the fetch cap", () => {
        expect(routeDebate(makeState({ needsMoreContext: true, contextFetches: 0 }))).toBe(MainNode.SWARM);
    });

    it("does not refetch once the context-fetch cap is hit", () => {
        expect(routeDebate(makeState({ needsMoreContext: true, contextFetches: MAX_CONTEXT_FETCHES }))).toBe(
            MainNode.CLAUDE_CODER,
        );
    });

    it("falls through to the claude coder when a sub-cap refetch is unaffordable", () => {
        /* totalCost 0.88 makes the 0.08 refetch projection cross the 0.95 soft ceiling while the 0.06 coder cycle still fits. */
        expect(routeDebate(makeState({ needsMoreContext: true, contextFetches: 0, totalCost: 0.88 }))).toBe(
            MainNode.CLAUDE_CODER,
        );
    });

    it("calls the SME tiebreaker when the debate cap is reached and affordable", () => {
        expect(routeDebate(makeState({ debateIterations: MAX_DEBATE_ITERATIONS }))).toBe(MainNode.SME_TIEBREAKER);
    });

    it("applies patches at the debate cap when the tiebreaker is unaffordable", () => {
        expect(routeDebate(makeState({ debateIterations: MAX_DEBATE_ITERATIONS, totalCost: 0.93 }))).toBe(
            MainNode.APPLY_PATCHES,
        );
    });

    it("continues the coder/critic cycle below the debate cap when affordable", () => {
        expect(routeDebate(makeState({ debateIterations: 1 }))).toBe(MainNode.CLAUDE_CODER);
    });

    it("applies patches below the debate cap when another cycle is unaffordable", () => {
        expect(routeDebate(makeState({ debateIterations: 1, totalCost: 0.93 }))).toBe(MainNode.APPLY_PATCHES);
    });
});

describe("routeAfterFrontierCritic", () => {
    it("escalates to the openai critic when a strong critic is required and affordable", () => {
        expect(routeAfterFrontierCritic(makeState({ strongCriticRequired: true }))).toBe(MainNode.OPENAI_CRITIC);
    });

    it("delegates to routeDebate when no strong critic is required", () => {
        expect(routeAfterFrontierCritic(makeState({ strongCriticRequired: false, consensusReached: true }))).toBe(
            MainNode.APPLY_PATCHES,
        );
    });

    it("delegates to routeDebate when a strong critic is required but unaffordable", () => {
        expect(
            routeAfterFrontierCritic(
                makeState({ strongCriticRequired: true, consensusReached: true, totalCost: 0.93 }),
            ),
        ).toBe(MainNode.APPLY_PATCHES);
    });
});

describe("routeAfterApplyPatches", () => {
    it("verifies when patch application succeeded", () => {
        expect(routeAfterApplyPatches(makeState({ patchApplicationFailed: false }))).toBe(MainNode.VERIFY);
    });

    it("finalizes on a failed patch when the budget is near", () => {
        expect(routeAfterApplyPatches(makeState({ patchApplicationFailed: true, totalCost: 1 }))).toBe(
            MainNode.FINALIZE,
        );
    });

    it("finalizes on a failed patch when the format-retry cap is hit", () => {
        expect(
            routeAfterApplyPatches(
                makeState({ patchApplicationFailed: true, patchFormatRetries: MAX_PATCH_FORMAT_RETRIES }),
            ),
        ).toBe(MainNode.FINALIZE);
    });

    it("retries via the claude coder on a failed patch when affordable and under the retry cap", () => {
        expect(routeAfterApplyPatches(makeState({ patchApplicationFailed: true }))).toBe(MainNode.CLAUDE_CODER);
    });
});

describe("routeAfterCoder", () => {
    it("re-applies patches when awaiting a patch reformat", () => {
        expect(routeAfterCoder(makeState({ awaitingPatchReformat: true }))).toBe(MainNode.APPLY_PATCHES);
    });

    it("sends a fresh draft to the frontier critic", () => {
        expect(routeAfterCoder(makeState({ awaitingPatchReformat: false }))).toBe(MainNode.FRONTIER_CRITIC);
    });
});

describe("routeAfterVerify", () => {
    it("finalizes when verification passed", () => {
        expect(routeAfterVerify(makeState({ verificationPassed: true }))).toBe(MainNode.FINALIZE);
    });

    it("finalizes when the budget is near", () => {
        expect(routeAfterVerify(makeState({ totalCost: 1 }))).toBe(MainNode.FINALIZE);
    });

    it("finalizes when the verify-attempt cap is hit", () => {
        expect(routeAfterVerify(makeState({ verifyAttempts: MAX_VERIFY_ATTEMPTS }))).toBe(MainNode.FINALIZE);
    });

    it("loops back to the claude coder when verification failed within budget and attempts", () => {
        expect(routeAfterVerify(makeState({ verificationPassed: false }))).toBe(MainNode.CLAUDE_CODER);
    });
});
