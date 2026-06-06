import { SwarmNode } from "./graph.ts";
import { ToolName } from "./tools.ts";
import { UsageKey } from "./usage.ts";

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

export const ReactDecisionKind = {
    ACT: "act",
    FINAL: "final",
} as const;

export type ReactDecisionKind = (typeof ReactDecisionKind)[keyof typeof ReactDecisionKind];

export const UNKNOWN_WORKER_STATUS_LABEL = "unknown";

export const WORKER_NODE: Record<WorkerKind, SwarmNode> = {
    [WorkerKind.CODE_EXPLORER]: SwarmNode.CODE_EXPLORER,
    [WorkerKind.INFRA_OPS]: SwarmNode.INFRA_OPS,
    [WorkerKind.WEB_RESEARCHER]: SwarmNode.WEB_RESEARCHER,
};

export const WORKER_ROUTES = {
    [SwarmNode.CODE_EXPLORER]: SwarmNode.CODE_EXPLORER,
    [SwarmNode.INFRA_OPS]: SwarmNode.INFRA_OPS,
    [SwarmNode.WEB_RESEARCHER]: SwarmNode.WEB_RESEARCHER,
} as const;

/* Per-worker catalogs turn out-of-scope tools into recoverable planner feedback. */
export const WORKER_TOOLS: Record<WorkerKind, readonly string[]> = {
    [WorkerKind.CODE_EXPLORER]: [ToolName.FIND_FILES, ToolName.GREP_CODE, ToolName.AST_READ],
    [WorkerKind.INFRA_OPS]: [ToolName.SHELL_EXEC, ToolName.FIND_FILES, ToolName.GREP_CODE, ToolName.AST_READ],
    [WorkerKind.WEB_RESEARCHER]: [ToolName.WEB_LOOKUP],
};

export const WORKER_USAGE_KEY: Record<WorkerKind, UsageKey> = {
    [WorkerKind.CODE_EXPLORER]: UsageKey.CODE_EXPLORER,
    [WorkerKind.INFRA_OPS]: UsageKey.INFRA_OPS,
    [WorkerKind.WEB_RESEARCHER]: UsageKey.WEB_RESEARCHER,
};
