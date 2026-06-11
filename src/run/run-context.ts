import { randomUUID } from "node:crypto";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { RUN_CONTEXT_CONFIG_KEY } from "../consts";
import { asRecord } from "../shared";
import type { UsageStats } from "../shared";

export type NodeVisit = { node: string; durationMs: number; costUsd: number };

export type RunUsageTotals = { totalCostUsd: number; totalTokens: number; usageStats: UsageStats };

/* A runId is both a checkpoint thread key and a filename component
   (reports/runs/<runId>.json); only the lowercase crypto.randomUUID() shape we
   generate is valid. Rejecting everything else stops a --resume value with path
   separators or ".." from traversing out of the reports directory. */
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const isRunId = (value: string): boolean => RUN_ID_PATTERN.test(value);

export type RunContext = {
    runId: string;
    profileName: string;
    startedAtMs: number;
    /* In-memory lifecycle records: survive a graph failure inside this process
       (the failure-path RunSummary reads them), not a process restart. */
    visits: NodeVisit[];
    usage: RunUsageTotals;
};

export const createRunContext = (options: { profileName: string; runId?: string }): RunContext => {
    /* A resumed runId must be one we generated; reject anything else before it
       becomes a checkpoint key or a summary filename. */
    if (options.runId !== undefined && !isRunId(options.runId)) {
        throw new Error(`Invalid runId "${options.runId}": expected a crypto.randomUUID() value.`);
    }
    return {
        runId: options.runId ?? randomUUID(),
        profileName: options.profileName,
        startedAtMs: Date.now(),
        visits: [],
        usage: { totalCostUsd: 0, totalTokens: 0, usageStats: {} },
    };
};

export const isRunContext = (value: unknown): value is RunContext => {
    const record = asRecord(value);
    if (!record) {
        return false;
    }
    const usage = asRecord(record.usage);
    return (
        typeof record.runId === "string" &&
        typeof record.profileName === "string" &&
        typeof record.startedAtMs === "number" &&
        Number.isFinite(record.startedAtMs) &&
        Array.isArray(record.visits) &&
        usage !== null &&
        typeof usage.totalCostUsd === "number" &&
        typeof usage.totalTokens === "number" &&
        asRecord(usage.usageStats) !== null
    );
};

/* Mirrors readProfile (src/models/resolve.ts): absent/null yields undefined,
   but a present-yet-malformed payload is a wiring bug that must fail loudly. */
export const readRunContext = (config?: LangGraphRunnableConfig): RunContext | undefined => {
    const candidate = config?.configurable?.[RUN_CONTEXT_CONFIG_KEY];
    if (candidate === undefined || candidate === null) {
        return undefined;
    }
    if (!isRunContext(candidate)) {
        throw new TypeError("configurable.runContext is present but is not a valid RunContext.");
    }
    return candidate;
};
