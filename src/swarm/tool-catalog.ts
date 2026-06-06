// Per-worker tool catalog, prompt, and telemetry key. The local OpenClaw adapters
// enforce path bounds + the command allowlist regardless, but restricting the
// catalog per worker keeps the planner focused and lets an out-of-scope tool be
// rejected with a clean, recoverable observation instead of a hard failure.
import { ToolName, UsageKey } from "../constants.js";
import { WorkerKind } from "../enums.js";
import { SystemPrompts } from "../prompts.js";

export const WORKER_TOOLS: Record<WorkerKind, readonly string[]> = {
    [WorkerKind.CODE_EXPLORER]: [ToolName.FIND_FILES, ToolName.GREP_CODE, ToolName.AST_READ],
    [WorkerKind.INFRA_OPS]: [ToolName.SHELL_EXEC, ToolName.FIND_FILES, ToolName.GREP_CODE, ToolName.AST_READ],
    [WorkerKind.WEB_RESEARCHER]: [ToolName.WEB_LOOKUP],
};

export const WORKER_PROMPTS: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: SystemPrompts.codeExplorer,
    [WorkerKind.INFRA_OPS]: SystemPrompts.infraOps,
    [WorkerKind.WEB_RESEARCHER]: SystemPrompts.webResearcher,
};

// usageStats key for each worker's planner LLM spend.
export const WORKER_USAGE_KEY: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: UsageKey.CODE_EXPLORER,
    [WorkerKind.INFRA_OPS]: UsageKey.INFRA_OPS,
    [WorkerKind.WEB_RESEARCHER]: UsageKey.WEB_RESEARCHER,
};
