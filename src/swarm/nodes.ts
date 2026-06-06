import { interrupt } from "@langchain/langgraph";
import { ModelRole, RESPONSE_FORMAT_JSON } from "../consts/models.ts";
import { UsageKey } from "../consts/usage.ts";
import { FailureType, WorkerKind, WorkerStatus } from "../consts/worker.ts";
import { SystemPrompts } from "../prompts";
import { asRecord, extractJsonObject } from "../shared/json.ts";
import { safeJson, truncate } from "../shared/text.ts";
import { emptyUsage, usageFromLlm } from "../shared/usage.ts";
import { callLlm } from "../tools/openclaw.ts";
import type { HitlInterruptPayload, HitlResolution } from "../types/hitl";
import type { SwarmWorkerStateValue } from "../state/swarm-state.ts";
import { runReactWorker } from "./react-worker.ts";

/* Blocked-worker fallbacks must not leak a full raw transcript into reasoning prompts. */
const MAX_BLOCKED_FALLBACK_CHARS = 600;

export const codeExplorer = (state: SwarmWorkerStateValue) => runReactWorker(state, WorkerKind.CODE_EXPLORER);
export const infraOps = (state: SwarmWorkerStateValue) => runReactWorker(state, WorkerKind.INFRA_OPS);
export const webResearcher = (state: SwarmWorkerStateValue) => runReactWorker(state, WorkerKind.WEB_RESEARCHER);

const parseWorkerKind = (content: string, fallback: WorkerKind): WorkerKind => {
    const parsed = asRecord(extractJsonObject(content));
    const value = typeof parsed?.workerKind === "string" ? parsed.workerKind.trim().toLowerCase() : "";
    switch (value) {
        case WorkerKind.CODE_EXPLORER:
            return WorkerKind.CODE_EXPLORER;
        case WorkerKind.INFRA_OPS:
            return WorkerKind.INFRA_OPS;
        case WorkerKind.WEB_RESEARCHER:
            return WorkerKind.WEB_RESEARCHER;
        default:
            return fallback;
    }
};

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
            ].filter(Boolean).join("\n\n"),
            { maxTokens: 120, responseFormat: RESPONSE_FORMAT_JSON, thinking: "disabled" },
        );
        selectedKind = parseWorkerKind(result.content, seededKind);
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
    const result = await callLlm(
        ModelRole.FRONTIER,
        SystemPrompts.smeOracle,
        state.escalationQuery,
        { maxTokens: 900, reasoningEffort: "high", thinking: "enabled" },
    );
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
        kind: "environment_failure",
        failureType: failure,
        workerKind: state.workerKind,
        subtask: state.subtask,
        reason,
        escalationAttempt: (state.escalationAttempts ?? 0) + 1,
    };
    const resolution = interrupt<HitlInterruptPayload, HitlResolution>(payload);

    if (!resolution || resolution.action === "abort") {
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
        { maxTokens: 1_200, responseFormat: RESPONSE_FORMAT_JSON, thinking: "disabled" },
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
    const reason = state.escalationQuery
        || state.escalationResponse
        || (state.rawToolOutput ? truncate(state.rawToolOutput, MAX_BLOCKED_FALLBACK_CHARS) : "")
        || "worker stopped without a recoverable result";
    const response = state.status === WorkerStatus.BLOCKED && state.escalationResponse
        ? state.escalationResponse
        : `Worker blocked after ${state.escalationAttempts ?? 0} escalation attempt(s) (${failure}): ${reason}`;

    return {
        status: WorkerStatus.BLOCKED,
        failureType: failure,
        escalationResponse: response,
        workerSummary: response,
    };
};
