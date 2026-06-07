/* Network-free guard layer before any planner-proposed tool call runs. */
import { FailureType, ReactDecisionKind, ToolErrorKind, type WorkerKind } from "../consts";
import { asRecord, extractJsonObject, errorMessage, readString } from "../shared";
import { ToolError, getDefaultToolRegistry } from "../tools";
import type { ToolArgs, ToolRegistry } from "../types/tools";
import type { ReactDecision, SanitizedAction } from "../types/swarm";

export type { ReactDecision, SanitizedAction } from "../types/swarm";

export const parseReactDecision = (content: string): ReactDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const thought = typeof parsed?.thought === "string" ? parsed.thought.trim() : "";
    const action = asRecord(parsed?.action);
    const tool = readString(action?.tool);
    if (tool) {
        const rawArgs = asRecord(action?.args);
        return { kind: ReactDecisionKind.ACT, thought, tool, args: (rawArgs ?? {}) as ToolArgs };
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
    rawArgs: ToolArgs,
    registry: ToolRegistry = getDefaultToolRegistry(),
): SanitizedAction => {
    return registry.validate(kind, tool, rawArgs);
};

/* Environment failures need HITL; reasoning errors go back to the worker. */
export const classifyFailure = (error: unknown): FailureType => {
    if (error instanceof ToolError) {
        switch (error.kind) {
            case ToolErrorKind.ENVIRONMENT:
            case ToolErrorKind.PROVIDER_UNAVAILABLE:
            case ToolErrorKind.TIMEOUT:
                return FailureType.ENVIRONMENT;
            case ToolErrorKind.EXECUTION:
            case ToolErrorKind.POLICY:
            case ToolErrorKind.VALIDATION:
                return FailureType.REASONING;
            default:
                return FailureType.UNKNOWN;
        }
    }

    const normalized = errorMessage(error).toLowerCase();
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
