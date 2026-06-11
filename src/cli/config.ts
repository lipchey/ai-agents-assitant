import { DEFAULT_PROFILE_NAME, EnvVar, isTruthyEnv, DEFAULT_COST_BUDGET_USD } from "../consts";
import { autoAbortResolver, createStdinHitlResolver } from "../hitl";
import { loadProfile, type Profile } from "../models";
import type { HitlResolver } from "../types/hitl";

/* AGENT_PROFILE selects profiles/<name>.json5 (or a path); defaults to the
   byte-stable default profile. Loaded once at startup, threaded via configurable. */
export const loadActiveProfile = (): Profile => loadProfile(process.env[EnvVar.PROFILE] ?? DEFAULT_PROFILE_NAME);

/* fallbackUsd is the active profile's budget; AGENT_COST_BUDGET_USD still wins. */
export const readCostBudgetUsd = (fallbackUsd: number = DEFAULT_COST_BUDGET_USD): number => {
    const configured = Number(process.env[EnvVar.COST_BUDGET_USD]);
    return Number.isFinite(configured) && configured > 0 ? configured : fallbackUsd;
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
