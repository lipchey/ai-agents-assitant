/*
 * Unit tests for the run kernel (src/run): node-lifecycle accounting, run-context
 * accessor validation, and the RunSummary writer. No network; the only I/O is a
 * temp-dir write in the summary suite.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { RUN_CONTEXT_CONFIG_KEY, RunStatus } from "../../src/consts";
import { wrapNode } from "../../src/run/node-lifecycle.ts";
import { createRunContext, readRunContext } from "../../src/run/run-context.ts";
import type { RunContext } from "../../src/run/run-context.ts";
import { buildRunSummary, writeRunSummary } from "../../src/run/run-summary.ts";
import type { RunSummary } from "../../src/run/run-summary.ts";

const configWith = (runContext: RunContext): LangGraphRunnableConfig => ({
    configurable: { [RUN_CONTEXT_CONFIG_KEY]: runContext },
});

describe("wrapNode", () => {
    it("records a visit and accumulates usage across calls", async () => {
        const runContext = createRunContext({ profileName: "test" });
        const node = wrapNode("router", async () => ({
            totalCost: 0.25,
            totalTokens: 10,
            usageStats: { router: { cost: 0.25, tokens: 10 } },
        }));

        const update = await node({}, configWith(runContext));

        expect(update.totalCost).toBe(0.25);
        expect(runContext.visits).toHaveLength(1);
        expect(runContext.visits[0]?.node).toBe("router");
        expect(runContext.visits[0]?.costUsd).toBe(0.25);
        expect(runContext.visits[0]?.durationMs).toBeGreaterThanOrEqual(0);
        expect(runContext.usage.totalCostUsd).toBeCloseTo(0.25);
        expect(runContext.usage.totalTokens).toBe(10);
        expect(runContext.usage.usageStats.router?.cost).toBeCloseTo(0.25);

        await node({}, configWith(runContext));

        expect(runContext.visits).toHaveLength(2);
        expect(runContext.usage.totalCostUsd).toBeCloseTo(0.5);
        expect(runContext.usage.totalTokens).toBe(20);
        expect(runContext.usage.usageStats.router?.cost).toBeCloseTo(0.5);
        expect(runContext.usage.usageStats.router?.tokens).toBe(20);
    });

    it("returns the update unchanged when no run context is threaded", async () => {
        const node = wrapNode("router", async () => ({ totalCost: 0.1, totalTokens: 2 }));

        await expect(node({})).resolves.toEqual({ totalCost: 0.1, totalTokens: 2 });
        await expect(node({}, {})).resolves.toEqual({ totalCost: 0.1, totalTokens: 2 });
        await expect(node({}, { configurable: {} })).resolves.toEqual({ totalCost: 0.1, totalTokens: 2 });
    });

    it("derives the cost/token delta from usageStats when totalCost is absent", async () => {
        const runContext = createRunContext({ profileName: "test" });
        const node = wrapNode("coder", async () => ({
            usageStats: { router: { cost: 0.3, tokens: 5 }, coder: { cost: 0.2, tokens: 7 } },
        }));

        await node({}, configWith(runContext));

        expect(runContext.visits[0]?.costUsd).toBeCloseTo(0.5);
        expect(runContext.usage.totalCostUsd).toBeCloseTo(0.5);
        expect(runContext.usage.totalTokens).toBe(12);
    });

    it("records a zero-cost visit and rethrows when the node throws", async () => {
        const runContext = createRunContext({ profileName: "test" });
        const node = wrapNode("verify", async () => {
            throw new Error("boom");
        });

        await expect(node({}, configWith(runContext))).rejects.toThrow("boom");
        expect(runContext.visits).toHaveLength(1);
        expect(runContext.visits[0]?.node).toBe("verify");
        expect(runContext.visits[0]?.costUsd).toBe(0);
    });
});

describe("readRunContext", () => {
    it("returns undefined when the key is absent", () => {
        expect(readRunContext(undefined)).toBeUndefined();
        expect(readRunContext({})).toBeUndefined();
        expect(readRunContext({ configurable: {} })).toBeUndefined();
    });

    it("returns the same object when valid", () => {
        const ctx = createRunContext({ profileName: "test" });
        expect(readRunContext(configWith(ctx))).toBe(ctx);
    });

    it("throws a TypeError when present but structurally invalid", () => {
        expect(() => readRunContext({ configurable: { [RUN_CONTEXT_CONFIG_KEY]: { runId: 5 } } })).toThrow(TypeError);
    });
});

describe("writeRunSummary", () => {
    const makeContext = (): RunContext => {
        const ctx = createRunContext({ profileName: "summary-profile" });
        ctx.visits.push({ node: "router", durationMs: 5, costUsd: 0.01 });
        return ctx;
    };

    it("writes each status to its own file and round-trips the frozen fields", () => {
        const dir = mkdtempSync(join(tmpdir(), "run-summary-"));

        const completed = buildRunSummary({
            runContext: makeContext(),
            task: "do a thing",
            status: RunStatus.COMPLETED,
            answer: "done",
            totalCostUsd: 0.42,
            totalTokens: 99,
            usageStats: { router: { cost: 0.42, tokens: 99 } },
            verificationPassed: true,
        });
        const completedPath = writeRunSummary(completed, dir);
        expect(existsSync(completedPath)).toBe(true);
        const parsedCompleted = JSON.parse(readFileSync(completedPath, "utf8")) as RunSummary;
        expect(parsedCompleted.runId).toBe(completed.runId);
        expect(parsedCompleted.task).toBe("do a thing");
        expect(parsedCompleted.profileName).toBe("summary-profile");
        expect(parsedCompleted.status).toBe(RunStatus.COMPLETED);
        expect(parsedCompleted.answer).toBe("done");
        expect(parsedCompleted.totalCostUsd).toBe(0.42);
        expect(parsedCompleted.totalTokens).toBe(99);
        expect(parsedCompleted.verificationPassed).toBe(true);
        expect(parsedCompleted.durationMs).toBeGreaterThanOrEqual(0);
        expect(parsedCompleted.nodeVisits).toHaveLength(1);
        expect(parsedCompleted.nodeVisits[0]?.node).toBe("router");
        expect("error" in parsedCompleted).toBe(false);

        const budgetStopped = buildRunSummary({
            runContext: makeContext(),
            task: "do a thing",
            status: RunStatus.BUDGET_STOPPED,
            answer: "partial",
            totalCostUsd: 1.99,
            totalTokens: 500,
            usageStats: {},
        });
        const budgetPath = writeRunSummary(budgetStopped, dir);
        const parsedBudget = JSON.parse(readFileSync(budgetPath, "utf8")) as RunSummary;
        expect(parsedBudget.status).toBe(RunStatus.BUDGET_STOPPED);
        expect("verificationPassed" in parsedBudget).toBe(false);
        expect("error" in parsedBudget).toBe(false);

        const failed = buildRunSummary({
            runContext: makeContext(),
            task: "do a thing",
            status: RunStatus.FAILED,
            answer: "",
            totalCostUsd: 0.05,
            totalTokens: 12,
            usageStats: {},
            error: "explosion",
        });
        const failedPath = writeRunSummary(failed, dir);
        const parsedFailed = JSON.parse(readFileSync(failedPath, "utf8")) as RunSummary;
        expect(parsedFailed.status).toBe(RunStatus.FAILED);
        expect(parsedFailed.answer).toBe("");
        expect(parsedFailed.error).toBe("explosion");
        expect("verificationPassed" in parsedFailed).toBe(false);

        expect(new Set([completedPath, budgetPath, failedPath]).size).toBe(3);
    });
});
