// Run configuration read from the environment for the CLI entrypoint.
import { DEFAULT_COST_BUDGET_USD, EnvVar, isTruthyEnv } from "../constants.js";
import { autoAbortResolver, createStdinHitlResolver, type HitlResolver } from "../hitl.js";

export const readCostBudgetUsd = (): number => {
    const configured = Number(process.env[EnvVar.COST_BUDGET_USD]);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_BUDGET_USD;
};

// HITL is ON by default and prompts on the terminal for swarm environment
// failures; on a non-TTY it degrades to graceful auto-abort. Set AGENT_HITL to a
// falsey value to force auto-abort even in an interactive shell.
export const buildHitlResolver = (): HitlResolver => {
    const raw = process.env[EnvVar.HITL]?.trim();
    if (raw && !isTruthyEnv(raw)) {
        return autoAbortResolver;
    }
    return createStdinHitlResolver();
};

// Autonomous file mutation is OFF unless explicitly opted into.
export const readPatchApplicationEnabled = (): boolean => isTruthyEnv(process.env[EnvVar.APPLY_PATCHES]);
