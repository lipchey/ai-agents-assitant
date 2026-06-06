export const WorkerStatus = {
    PENDING: "pending",
    WORKING: "working",
    ESCALATING: "escalating",
    BLOCKED: "blocked",
    DONE: "done",
    FAILED: "failed",
} as const;

export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus];

export const FailureType = {
    NONE: "none",
    REASONING: "reasoning",
    ENVIRONMENT: "environment",
    UNKNOWN: "unknown",
} as const;

export type FailureType = (typeof FailureType)[keyof typeof FailureType];

export const WorkerKind = {
    CODE_EXPLORER: "code_explorer",
    INFRA_OPS: "infra_ops",
    WEB_RESEARCHER: "web_researcher",
} as const;

export type WorkerKind = (typeof WorkerKind)[keyof typeof WorkerKind];
