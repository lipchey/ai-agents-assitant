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
    ModelRole,
    ModelTier,
    PROFILE_CONFIG_KEY,
} from "../consts";
import {
    isFullBinding,
    isValidatedProfile,
    loadProfile,
    parseProfile,
    type ModelBinding,
    type Profile,
} from "./profile.ts";

let defaultProfileCache: Profile | undefined;

/* Module-default profile, lazily loaded once and reused. */
export const getDefaultProfile = (): Profile => (defaultProfileCache ??= loadProfile());

export const readProfile = (config?: LangGraphRunnableConfig): Profile => {
    const candidate = config?.configurable?.[PROFILE_CONFIG_KEY];
    if (candidate === undefined || candidate === null) {
        return getDefaultProfile();
    }
    /* A profile injected via configurable must satisfy the same contract as the
       loader; parseProfile is skipped only for objects it already validated. */
    return isValidatedProfile(candidate) ? candidate : parseProfile(candidate, "configurable.profile");
};

/* Code-owned default tier for each role (design §3). `sme` is the only default
   consumer of the `frontier` tier — the cascade philosophy: the top model runs
   only behind escalation gates. A profile's per-role override can reassign this. */
export const DEFAULT_ROLE_TIER: Record<ModelRole, ModelTier> = {
    [ModelRole.ROUTER]: ModelTier.WORKER,
    [ModelRole.FIREWALL]: ModelTier.WORKER,
    [ModelRole.WORKER]: ModelTier.WORKER,
    [ModelRole.CODER]: ModelTier.SKILLED,
    [ModelRole.REASONER]: ModelTier.ADVISER,
    [ModelRole.ARCHITECT]: ModelTier.ADVISER,
    [ModelRole.CRITIC]: ModelTier.ADVISER,
    [ModelRole.SME]: ModelTier.FRONTIER,
};

/* Precedence: full-binding override > tier reassignment > code-default tier.
   Param merge: role-override params win key-by-key over the tier binding's params.
   Returns a plain ModelBinding — everything downstream (per-call merge, transport
   dispatch, structuredSchema) is unchanged. */
export const resolveBinding = (role: ModelRole, profile: Profile): ModelBinding => {
    const override = profile.roles?.[role];
    if (override && isFullBinding(override)) {
        /* Full-binding override: return verbatim, bypassing the tier layer. */
        return override;
    }
    const tier = override?.tier ?? DEFAULT_ROLE_TIER[role];
    const base = profile.tiers[tier];
    const params = { ...base.params, ...override?.params };
    /* Omit `params` entirely when neither side contributes one (exactOptionalPropertyTypes:
       a params-less tier binding must not resolve to a spurious empty `params: {}`). */
    return Object.keys(params).length > 0 ? { ...base, params } : { ...base };
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
