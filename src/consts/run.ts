/* LangGraph reserves configurable.thread_id as the checkpoint thread key; the
   main graph sets it to the runId so --resume can re-enter the same thread. */
export const THREAD_ID_CONFIG_KEY = "thread_id";

/* Mirrors TOOL_REGISTRY_CONFIG_KEY / PROFILE_CONFIG_KEY: non-serializable run
   context rides configurable, never checkpointed graph state. */
export const RUN_CONTEXT_CONFIG_KEY = "runContext";

export const RUN_REPORTS_DIR = "reports/runs";
export const CHECKPOINT_DB_PATH = "reports/checkpoints.sqlite";

export const RunStatus = {
    COMPLETED: "completed",
    BUDGET_STOPPED: "budget_stopped",
    FAILED: "failed",
} as const;

export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];
