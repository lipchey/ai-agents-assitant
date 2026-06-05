export enum WorkerStatus {
    PENDING = "pending",
    WORKING = "working",
    ESCALATING = "escalating",
    BLOCKED = "blocked",
    DONE = "done",
    FAILED = "failed",
}

export enum FailureType {
    NONE = "none",
    REASONING = "reasoning",
    ENVIRONMENT = "environment",
    UNKNOWN = "unknown",
}

export enum WorkerKind {
    CODE_EXPLORER = "code_explorer",
    INFRA_OPS = "infra_ops",
    WEB_RESEARCHER = "web_researcher",
}
