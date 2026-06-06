import { EnvVar, isTruthyEnv } from "../consts/env.ts";
import { DEFAULT_COST_BUDGET_USD } from "../consts/tuning.ts";
import { autoAbortResolver, createStdinHitlResolver } from "../hitl/resolvers.ts";
import type { HitlResolver } from "../types/hitl/index.ts";

export const readCostBudgetUsd = (): number => {
    const configured = Number(process.env[EnvVar.COST_BUDGET_USD]);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_BUDGET_USD;
};

/* HITL defaults to interactive when a TTY exists; falsey AGENT_HITL forces auto-abort. */
export const buildHitlResolver = (): HitlResolver => {
    const raw = process.env[EnvVar.HITL]?.trim();
    if (raw && !isTruthyEnv(raw)) {
        return autoAbortResolver;
    }
    return createStdinHitlResolver();
};

export const readPatchApplicationEnabled = (): boolean => isTruthyEnv(process.env[EnvVar.APPLY_PATCHES]);
