import { interrupt } from "@langchain/langgraph";
import {
    ModelRole,
    RESPONSE_FORMAT_JSON,
    FailureType,
    HitlInterruptKind,
    HitlResolutionAction,
    MAX_BLOCKED_FALLBACK_CHARS,
    UsageKey,
    WorkerKind,
    WorkerStatus,
} from "../consts";
import { SystemPrompts } from "../prompts";
import { safeJson, truncate, emptyUsage, usageFromLlm } from "../shared";
import { callLlm } from "../tools";
import { workerKindDecisionSchema } from "../types/graph";
import type { ToolRegistry } from "../types/tools";
import type { HitlInterruptPayload, HitlResolution } from "../types/hitl";
import type { SwarmWorkerStateValue } from "../state";
import { runReactWorker } from "./react-worker.ts";
import { parseWorkerKind } from "./tool-validation.ts";

export const createWorkerNodes = (tools: ToolRegistry) => ({
    codeExplorer: (state: SwarmWorkerStateValue) => runReactWorker(state, WorkerKind.CODE_EXPLORER, tools),
    infraOps: (state: SwarmWorkerStateValue) => runReactWorker(state, WorkerKind.INFRA_OPS, tools),
    webResearcher: (state: SwarmWorkerStateValue) => runReactWorker(state, WorkerKind.WEB_RESEARCHER, tools),
});

export const leadDelegator = async (state: SwarmWorkerStateValue) => {
    const seededKind = state.workerKind ?? WorkerKind.CODE_EXPLORER;
    let selectedKind = seededKind;
    let usage = emptyUsage();

    try {
        const result = await callLlm(
            ModelRole.WORKER,
            SystemPrompts.leadDelegator,
            [
                `Subtask:\n${state.subtask}`,
                state.escalationResponse ? `Escalation guidance:\n${state.escalationResponse}` : "",
                `Heuristic suggestion: ${seededKind}`,
            ]
                .filter(Boolean)
                .join("\n\n"),
            { maxTokens: 120, responseFormat: RESPONSE_FORMAT_JSON, structuredSchema: workerKindDecisionSchema },
        );
        selectedKind = parseWorkerKind(result.content, seededKind, result.parsed);
        usage = usageFromLlm(result);
    } catch {
        /* A transient delegator failure should not abort deterministic worker fallback. */
    }

    return {
        workerKind: selectedKind,
        status: WorkerStatus.WORKING,
        attempts: state.attempts ?? 0,
        escalationAttempts: state.escalationAttempts ?? 0,
        failureType: FailureType.NONE,
        totalCost: usage.cost,
        totalTokens: usage.tokens,
        usageStats: { [UsageKey.LEAD_DELEGATOR]: usage },
    };
};

export const smeOracle = async (state: SwarmWorkerStateValue) => {
    const result = await callLlm(ModelRole.REASONER, SystemPrompts.smeOracle, state.escalationQuery, {
        maxTokens: 900,
    });
    return {
        escalationResponse: result.content,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.FRONTIER_SME]: usageFromLlm(result) },
    };
};

/* Nothing runs before interrupt(), so resume re-execution is safe. */
export const humanGate = (state: SwarmWorkerStateValue) => {
    const failure = state.failureType ?? FailureType.UNKNOWN;
    const reason = state.escalationQuery ?? "unknown environment error";

    const payload: HitlInterruptPayload = {
        kind: HitlInterruptKind.ENVIRONMENT_FAILURE,
        failureType: failure,
        workerKind: state.workerKind,
        subtask: state.subtask,
        reason,
        escalationAttempt: (state.escalationAttempts ?? 0) + 1,
    };
    const resolution = interrupt<HitlInterruptPayload, HitlResolution>(payload);

    if (!resolution || resolution.action === HitlResolutionAction.ABORT) {
        return {
            status: WorkerStatus.BLOCKED,
            escalationResponse: `Manual resolution required (${failure}): ${reason}`,
        };
    }

    /* Guidance becomes escalation context for the bounded retry. */
    return {
        status: WorkerStatus.WORKING,
        failureType: FailureType.NONE,
        escalationResponse: resolution.guidance,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
    };
};

export const workerCompress = async (state: SwarmWorkerStateValue) => {
    const result = await callLlm(
        ModelRole.FIREWALL,
        SystemPrompts.workerCompress,
        state.rawToolOutput || safeJson(state.toolCalls),
        { maxTokens: 1_200, responseFormat: RESPONSE_FORMAT_JSON },
    );
    return {
        workerSummary: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.FIREWALL]: usageFromLlm(result) },
    };
};

export const blocked = (state: SwarmWorkerStateValue) => {
    const failure = state.failureType ?? FailureType.UNKNOWN;
    const reason =
        state.escalationQuery ||
        state.escalationResponse ||
        (state.rawToolOutput ? truncate(state.rawToolOutput, MAX_BLOCKED_FALLBACK_CHARS) : "") ||
        "worker stopped without a recoverable result";
    const response =
        state.status === WorkerStatus.BLOCKED && state.escalationResponse
            ? state.escalationResponse
            : `Worker blocked after ${state.escalationAttempts ?? 0} escalation attempt(s) (${failure}): ${reason}`;

    return {
        status: WorkerStatus.BLOCKED,
        failureType: failure,
        escalationResponse: response,
        workerSummary: response,
    };
};
