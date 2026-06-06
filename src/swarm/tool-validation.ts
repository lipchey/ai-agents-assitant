/* Network-free guard layer before any planner-proposed tool call runs. */
import { ToolName, FailureType, ReactDecisionKind, SAFE_DIRECT_EXEC_COMMANDS, SHELL_EXEC_TIMEOUT_S, WorkerKind, WORKER_TOOLS } from "../consts";
import { asRecord, extractJsonObject, clampInt, readString } from "../shared";
import type { OpenClawRpcArgs } from "../tools";
import type { ReactDecision, SanitizedAction } from "../types/swarm";

export type { ReactDecision, SanitizedAction } from "../types/swarm";

export const parseReactDecision = (content: string): ReactDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const thought = typeof parsed?.thought === "string" ? parsed.thought.trim() : "";
    const action = asRecord(parsed?.action);
    const tool = readString(action?.tool);
    if (tool) {
        const rawArgs = asRecord(action?.args);
        return { kind: ReactDecisionKind.ACT, thought, tool, args: (rawArgs ?? {}) as OpenClawRpcArgs };
    }
    const final = typeof parsed?.final === "string" ? parsed.final.trim() : "";
    if (final) {
        return { kind: ReactDecisionKind.FINAL, thought, final };
    }
    /* Prose fallback converges instead of spending more planner steps. */
    return { kind: ReactDecisionKind.FINAL, thought, final: content.trim() };
};

export const sanitizeToolArgs = (
    kind: WorkerKind,
    tool: string,
    rawArgs: OpenClawRpcArgs,
): SanitizedAction => {
    if (!WORKER_TOOLS[kind].includes(tool)) {
        return { ok: false, error: `Tool "${tool}" is not available to ${kind}. Allowed: ${WORKER_TOOLS[kind].join(", ")}.` };
    }

    switch (tool) {
        case ToolName.FIND_FILES: {
            const pattern = readString(rawArgs.pattern) ?? "src/**/*.ts";
            const path = readString(rawArgs.path) ?? ".";
            const limit = clampInt(rawArgs.limit, 100, 1, 500);
            return { ok: true, args: { path, pattern, limit } };
        }
        case ToolName.GREP_CODE: {
            const pattern = readString(rawArgs.pattern) ?? readString(rawArgs.query);
            if (!pattern) {
                return { ok: false, error: 'grep_code requires a non-empty "pattern".' };
            }
            const path = readString(rawArgs.path) ?? ".";
            const limit = clampInt(rawArgs.limit, 80, 1, 500);
            return {
                ok: true,
                args: { path, pattern, ignoreCase: rawArgs.ignoreCase !== false, literal: rawArgs.literal === true, limit },
            };
        }
        case ToolName.AST_READ: {
            const path = readString(rawArgs.path) ?? readString(rawArgs.subtask);
            if (!path) {
                return { ok: false, error: 'ast_read requires a "path" to a file.' };
            }
            return { ok: true, args: { path } };
        }
        case ToolName.SHELL_EXEC: {
            const command = readString(rawArgs.command);
            if (!command) {
                return { ok: false, error: 'shell_exec requires a "command".' };
            }
            if (!SAFE_DIRECT_EXEC_COMMANDS.has(command)) {
                return {
                    ok: false,
                    error: `Command "${command}" is not allowlisted. Choose exactly one of: ${[...SAFE_DIRECT_EXEC_COMMANDS].join(" | ")}.`,
                };
            }
            return { ok: true, args: { command, timeout: SHELL_EXEC_TIMEOUT_S } };
        }
        case ToolName.WEB_LOOKUP: {
            const query = readString(rawArgs.query) ?? readString(rawArgs.subtask);
            if (!query) {
                return { ok: false, error: 'web_lookup requires a "query".' };
            }
            return { ok: true, args: { query } };
        }
        default:
            return { ok: false, error: `Tool "${tool}" is not available to ${kind}.` };
    }
};

/* Environment failures need HITL; reasoning errors go back to the worker. */
export const classifyFailure = (errorMessage: string): FailureType => {
    const normalized = errorMessage.toLowerCase();
    if (
        normalized.includes("not available")
        || normalized.includes("not found")
        || normalized.includes("unauthorized")
        || normalized.includes("permission")
        || normalized.includes("gateway")
        || normalized.includes("timeout")
    ) {
        return FailureType.ENVIRONMENT;
    }
    return FailureType.REASONING;
};

export const readExitCode = (value: unknown): number | undefined => {
    const record = asRecord(value);
    const details = asRecord(record?.details);
    const exitCode = details?.exitCode ?? record?.exitCode;
    return typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : undefined;
};
