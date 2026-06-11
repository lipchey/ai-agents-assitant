/*
 * Tests for the R7 programmatic entrypoint guards (src/app/run-agent-task.ts).
 * Only the pre-run validation surface is testable offline: every guard below
 * must reject BEFORE the runtime (gateway / tool registry / graph) is touched.
 * The happy path is exercised by the live bench harness and, from R8 on, by
 * the fake-provider offline e2e.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentTask } from "../../src/app/run-agent-task.ts";
import type { RunAgentTaskOptions } from "../../src/app/run-agent-task.ts";

describe("runAgentTask option guards", () => {
    it("rejects an empty task", async () => {
        await expect(runAgentTask("")).rejects.toThrow(/non-empty task/u);
    });

    it("rejects a whitespace-only task", async () => {
        await expect(runAgentTask("   \n\t ")).rejects.toThrow(/non-empty task/u);
    });

    it("rejects a non-string task from untyped callers", async () => {
        await expect(runAgentTask(undefined as unknown as string)).rejects.toThrow(/non-empty task/u);
    });

    it('rejects hitl values other than "off"', async () => {
        const options = { hitl: "interactive" } as unknown as RunAgentTaskOptions;
        await expect(runAgentTask("task", options)).rejects.toThrow(/hitl: "off"/u);
    });

    it("rejects a workspaceDir other than the current working directory", async () => {
        await expect(runAgentTask("task", { workspaceDir: join(process.cwd(), "bench") })).rejects.toThrow(
            /reserved until the workspace seam/u,
        );
    });

    it("rejects a NaN budgetUsd before any runtime startup", async () => {
        /* Number("oops") is the realistic bench-var failure mode. */
        await expect(runAgentTask("task", { budgetUsd: Number("oops") })).rejects.toThrow(/budgetUsd/u);
    });

    it("rejects a zero budgetUsd before any runtime startup", async () => {
        await expect(runAgentTask("task", { budgetUsd: 0 })).rejects.toThrow(/budgetUsd/u);
    });

    it("rejects a negative budgetUsd before any runtime startup", async () => {
        await expect(runAgentTask("task", { budgetUsd: -1 })).rejects.toThrow(/budgetUsd/u);
    });

    it("rejects an infinite budgetUsd before any runtime startup", async () => {
        await expect(runAgentTask("task", { budgetUsd: Number.POSITIVE_INFINITY })).rejects.toThrow(/budgetUsd/u);
    });

    it("accepts a valid budgetUsd (fails later, on the profile)", async () => {
        /* A finite positive budget passes the guard; the unknown profile then
           makes the call fail AFTER it, proving the budget guard let it through. */
        await expect(runAgentTask("task", { budgetUsd: 0.05, profile: "definitely-not-a-profile" })).rejects.toThrow(
            /definitely-not-a-profile/u,
        );
    });

    it("rejects an unknown profile name before any runtime startup", async () => {
        await expect(runAgentTask("task", { profile: "definitely-not-a-profile" })).rejects.toThrow(
            /definitely-not-a-profile/u,
        );
    });

    it("accepts workspaceDir equal to the current working directory (fails later, on the profile)", async () => {
        /* The unknown profile makes the call fail AFTER the workspaceDir guard,
           proving cwd passes it without starting the runtime. */
        await expect(
            runAgentTask("task", { workspaceDir: process.cwd(), profile: "definitely-not-a-profile" }),
        ).rejects.toThrow(/definitely-not-a-profile/u);
    });
});
