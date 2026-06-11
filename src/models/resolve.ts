/* Binding/tuning resolution against the active profile. The configurable accessor
   mirrors readToolRegistry / readHitlResolver: a module-default fallback keeps the
   pre-profile behavior when no profile is threaded. */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
    CONFIDENCE_ESCALATION_THRESHOLD,
    DEFAULT_LLM_MAX_RETRIES,
    MAX_CONTEXT_FETCHES,
    MAX_DEBATE_ITERATIONS,
    MAX_PATCH_FORMAT_RETRIES,
    MAX_REACT_STEPS,
    MAX_VERIFY_ATTEMPTS,
    PROFILE_CONFIG_KEY,
} from "../consts";
import type { ModelRole } from "../consts";
import { loadProfile, type ModelBinding, type Profile } from "./profile.ts";

let defaultProfileCache: Profile | undefined;

/* Module-default profile, lazily loaded once and reused. */
export const getDefaultProfile = (): Profile => (defaultProfileCache ??= loadProfile());

const isProfile = (value: unknown): value is Profile =>
    typeof value === "object" && value !== null && "roles" in value && "transport" in value;

export const readProfile = (config?: LangGraphRunnableConfig): Profile => {
    const candidate = config?.configurable?.[PROFILE_CONFIG_KEY];
    return isProfile(candidate) ? candidate : getDefaultProfile();
};

export const resolveBinding = (role: ModelRole, profile: Profile): ModelBinding => {
    const binding = profile.roles[role];
    if (!binding) {
        throw new Error(`Profile "${profile.name}" has no binding for role "${role}".`);
    }
    return binding;
};

export type ResolvedTuning = {
    confidenceEscalationThreshold: number;
    maxDebateIterations: number;
    maxVerifyAttempts: number;
    maxContextFetches: number;
    maxPatchFormatRetries: number;
    maxReactSteps: number;
    llmMaxRetries: number;
};

/* Profile tuning overrides the consts; an omitted key keeps today's default, so the
   default profile (no tuning block) reproduces the pre-refactor cap behavior. */
export const resolveTuning = (profile: Profile): ResolvedTuning => {
    const tuning = profile.tuning ?? {};
    return {
        confidenceEscalationThreshold: tuning.confidenceEscalationThreshold ?? CONFIDENCE_ESCALATION_THRESHOLD,
        maxDebateIterations: tuning.maxDebateIterations ?? MAX_DEBATE_ITERATIONS,
        maxVerifyAttempts: tuning.maxVerifyAttempts ?? MAX_VERIFY_ATTEMPTS,
        maxContextFetches: tuning.maxContextFetches ?? MAX_CONTEXT_FETCHES,
        maxPatchFormatRetries: tuning.maxPatchFormatRetries ?? MAX_PATCH_FORMAT_RETRIES,
        maxReactSteps: tuning.maxReactSteps ?? MAX_REACT_STEPS,
        llmMaxRetries: tuning.llmMaxRetries ?? DEFAULT_LLM_MAX_RETRIES,
    };
};
