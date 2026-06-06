import { SystemPrompts } from "../prompts";
import { WorkerKind } from "./worker.ts";

export const WORKER_PROMPTS: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: SystemPrompts.codeExplorer,
    [WorkerKind.INFRA_OPS]: SystemPrompts.infraOps,
    [WorkerKind.WEB_RESEARCHER]: SystemPrompts.webResearcher,
};
