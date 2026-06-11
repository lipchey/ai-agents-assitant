import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN_REPORTS_DIR } from "../consts";
import type { RunStatus } from "../consts";
import type { UsageStats } from "../shared";
import { isRunId } from "./run-context.ts";
import type { NodeVisit, RunContext } from "./run-context.ts";

/* FROZEN contract (design spec §3.4): field names and order are consumed by the
   bench provider and regressed against; do not rename or reorder. */
export interface RunSummary {
    runId: string;
    task: string;
    profileName: string;
    status: RunStatus;
    answer: string;
    verificationPassed?: boolean;
    totalCostUsd: number;
    totalTokens: number;
    usageStats: UsageStats;
    durationMs: number;
    nodeVisits: NodeVisit[];
    error?: string;
}

export const buildRunSummary = (input: {
    runContext: RunContext;
    task: string;
    status: RunStatus;
    answer: string;
    totalCostUsd: number;
    totalTokens: number;
    usageStats: UsageStats;
    verificationPassed?: boolean;
    error?: string;
}): RunSummary => ({
    runId: input.runContext.runId,
    task: input.task,
    profileName: input.runContext.profileName,
    status: input.status,
    answer: input.answer,
    ...(input.verificationPassed !== undefined ? { verificationPassed: input.verificationPassed } : {}),
    totalCostUsd: input.totalCostUsd,
    totalTokens: input.totalTokens,
    usageStats: input.usageStats,
    durationMs: Date.now() - input.runContext.startedAtMs,
    nodeVisits: input.runContext.visits,
    ...(input.error !== undefined ? { error: input.error } : {}),
});

/* Synchronous write so the SIGINT failure path completes before process.exit. */
export const writeRunSummary = (summary: RunSummary, baseDir: string = RUN_REPORTS_DIR): string => {
    /* The runId is a filename component; reject anything that could traverse out
       of baseDir before joining the path (defense for any future caller). */
    if (!isRunId(summary.runId)) {
        throw new Error(`Refusing to write run summary: invalid runId "${summary.runId}".`);
    }
    mkdirSync(baseDir, { recursive: true });
    const path = join(baseDir, `${summary.runId}.json`);
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
    return path;
};
