import { DEFAULT_PROFILE_NAME, EnvVar, isTruthyEnv, DEFAULT_COST_BUDGET_USD, RUN_REPORTS_DIR } from "../consts";
import { autoAbortResolver, createStdinHitlResolver } from "../hitl";
import { loadProfile, type Profile } from "../models";
import { readRunSummary } from "../run";
import type { HitlResolver } from "../types/hitl";

/* The name/path the operator explicitly chose: the --profile flag wins, else a
   non-blank AGENT_PROFILE. A blank env value (e.g. the unset PROFILE passthrough
   in run-task.sh) is treated as no selection. Returns undefined when neither is set. */
export const explicitProfileSelection = (cliProfile?: string): string | undefined => {
    if (cliProfile !== undefined) {
        return cliProfile;
    }
    const envProfile = process.env[EnvVar.PROFILE]?.trim();
    return envProfile ? envProfile : undefined;
};

/* Profile precedence: explicit --profile flag > AGENT_PROFILE env > "default".
   Loaded once at startup, threaded via configurable. */
export const loadActiveProfile = (cliProfile?: string): Profile =>
    loadProfile(explicitProfileSelection(cliProfile) ?? DEFAULT_PROFILE_NAME);

export type ResumeProfileResolution = {
    profile: Profile;
    /* "recovered" = read back from the original run's summary; "explicit" = the
       operator overrode it (honored, surfaced by the caller when it differs);
       "fallback" = no recoverable profile, default loaded. */
    source: "explicit" | "recovered" | "fallback";
    /* The original run's recorded profile name, when a summary was found. */
    recordedName?: string;
};

/* Resume must re-enter the SAME run under its original profile (frozen
   RunSummary.profileName is the recovery key). With no explicit selection we
   recover that profile from reports/runs/<runId>.json; an explicit --profile /
   AGENT_PROFILE still wins (precedence parity with loadActiveProfile) but the
   caller warns when it differs. A missing/unreadable summary — or a recorded name
   that no longer resolves to a profiles/<name>.json5 (e.g. a one-off path profile)
   — falls back to the default. */
export const resolveResumeProfile = (
    resumeRunId: string,
    cliProfile?: string,
    baseDir: string = RUN_REPORTS_DIR,
): ResumeProfileResolution => {
    const recordedName = readRunSummary(resumeRunId, baseDir)?.profileName;
    const explicit = explicitProfileSelection(cliProfile);
    if (explicit !== undefined) {
        return {
            profile: loadProfile(explicit),
            source: "explicit",
            ...(recordedName !== undefined ? { recordedName } : {}),
        };
    }
    if (recordedName !== undefined) {
        try {
            return { profile: loadProfile(recordedName), source: "recovered", recordedName };
        } catch {
            /* The recorded name no longer maps to a profile file; fall through. */
        }
    }
    return {
        profile: loadProfile(DEFAULT_PROFILE_NAME),
        source: "fallback",
        ...(recordedName !== undefined ? { recordedName } : {}),
    };
};

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
