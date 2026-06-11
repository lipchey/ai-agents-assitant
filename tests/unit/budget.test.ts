import { describe, expect, it } from "vitest";
import {
    COST_BUDGET_MIN_REMAINING_USD,
    COST_BUDGET_SOFT_CEILING_RATIO,
    DEFAULT_COST_BUDGET_USD,
    GraphComplexity,
    PROJECTED_CODER_REVIEW_CYCLE_USD,
    WorkerStatus,
} from "../../src/consts";
import { canSpendUsd, isCostBudgetNear } from "../../src/graph/budget.ts";
import type { GraphStateValue } from "../../src/state";

/* Full GraphStateValue fixture; only costBudgetUsd and totalCost drive these functions. */
const makeState = (costBudgetUsd: number, totalCost: number): GraphStateValue => ({
    originalTask: "",
    complexity: GraphComplexity.TRIVIAL,
    routeConfidence: 0,
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
    frontierConfidence: 0,
    strongEscalationRequired: false,
    strongEscalationReason: "",
    criticConfidence: 0,
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
    costBudgetUsd,
    finalAnswer: "",
    contextFetches: 0,
    verifyAttempts: 0,
    patchFormatRetries: 0,
    awaitingPatchReformat: false,
    totalCost,
    totalTokens: 0,
    usageStats: {},
});

const softCeiling = DEFAULT_COST_BUDGET_USD * COST_BUDGET_SOFT_CEILING_RATIO;

describe("isCostBudgetNear soft-ceiling boundary", () => {
    it("is not near just below the soft ceiling", () => {
        const state = makeState(DEFAULT_COST_BUDGET_USD, softCeiling - 0.01);
        expect(isCostBudgetNear(state)).toBe(false);
        expect(canSpendUsd(state, 0)).toBe(true);
    });

    it("is near exactly at the soft ceiling (comparison is >=)", () => {
        const state = makeState(DEFAULT_COST_BUDGET_USD, softCeiling);
        expect(isCostBudgetNear(state)).toBe(true);
        expect(canSpendUsd(state, 0)).toBe(false);
    });

    it("is near just above the soft ceiling", () => {
        const state = makeState(DEFAULT_COST_BUDGET_USD, softCeiling + 0.01);
        expect(isCostBudgetNear(state)).toBe(true);
        expect(canSpendUsd(state, 0)).toBe(false);
    });
});

describe("isCostBudgetNear projected-cost edge", () => {
    const state = makeState(DEFAULT_COST_BUDGET_USD, 0.9);

    it("is not near when only the actual cost is counted", () => {
        expect(isCostBudgetNear(state)).toBe(false);
        expect(canSpendUsd(state, 0)).toBe(true);
    });

    it("is near when the projected cost crosses the soft ceiling", () => {
        expect(isCostBudgetNear(state, PROJECTED_CODER_REVIEW_CYCLE_USD)).toBe(true);
        expect(canSpendUsd(state, PROJECTED_CODER_REVIEW_CYCLE_USD)).toBe(false);
    });
});

describe("isCostBudgetNear minimum-remaining guard", () => {
    it("is near when remaining budget falls within the floor even below the ceiling", () => {
        const budget = 0.05;
        const totalCost = budget - COST_BUDGET_MIN_REMAINING_USD + 0.001;
        const state = makeState(budget, totalCost);
        expect(isCostBudgetNear(state)).toBe(true);
        expect(canSpendUsd(state, 0)).toBe(false);
    });

    it("is not near when a small budget still has comfortable headroom", () => {
        const state = makeState(0.05, 0.01);
        expect(isCostBudgetNear(state)).toBe(false);
        expect(canSpendUsd(state, 0)).toBe(true);
    });
});

describe("isCostBudgetNear unset or non-positive budget", () => {
    it("is never near when the budget is zero (treated as unlimited)", () => {
        const state = makeState(0, 999);
        expect(isCostBudgetNear(state, 999)).toBe(false);
        expect(canSpendUsd(state, 999)).toBe(true);
    });

    it("is never near when the budget is negative", () => {
        const state = makeState(-1, 999);
        expect(isCostBudgetNear(state, 999)).toBe(false);
        expect(canSpendUsd(state, 999)).toBe(true);
    });
});
