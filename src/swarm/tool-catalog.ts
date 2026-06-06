/* Per-worker catalogs turn out-of-scope tools into recoverable planner feedback. */
import { ToolName } from "../consts/tools.ts";
import { UsageKey } from "../consts/usage.ts";
import { WorkerKind } from "../consts/worker.ts";
import { SystemPrompts } from "../prompts.ts";

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

export const WORKER_USAGE_KEY: Record<WorkerKind, UsageKey> = {
    [WorkerKind.CODE_EXPLORER]: UsageKey.CODE_EXPLORER,
    [WorkerKind.INFRA_OPS]: UsageKey.INFRA_OPS,
    [WorkerKind.WEB_RESEARCHER]: UsageKey.WEB_RESEARCHER,
};
