/* Non-serializable HITL resolver stays in LangGraph config, not graph state. */
export const HITL_RESOLVER_CONFIG_KEY = "hitlResolver";

export const HITL_THREAD_CONFIG_KEY = "thread_id";
export const HITL_THREAD_ID_PREFIX = "swarm-";

export const HitlInterruptKind = {
    ENVIRONMENT_FAILURE: "environment_failure",
} as const;

export type HitlInterruptKind = (typeof HitlInterruptKind)[keyof typeof HitlInterruptKind];

export const HitlResolutionAction = {
    RETRY: "retry",
    ABORT: "abort",
} as const;

export type HitlResolutionAction = (typeof HitlResolutionAction)[keyof typeof HitlResolutionAction];
