// Swarm node implementations: the three ReAct worker entrypoints, the LLM lead
// delegator, the SME recovery oracle, the HITL human gate, the output compressor,
// and the terminal blocked node.
import { interrupt } from "@langchain/langgraph";
import { ModelRole, RESPONSE_FORMAT_JSON, UsageKey } from "../constants.js";
import { FailureType, WorkerKind, WorkerStatus } from "../enums.js";
import type { HitlInterruptPayload, HitlResolution } from "../hitl.js";
import { SystemPrompts } from "../prompts.js";
import { asRecord, extractJsonObject } from "../shared/json.js";
import { safeJson, truncate } from "../shared/text.js";
import { emptyUsage, usageFromLlm } from "../shared/usage.js";
import { SwarmWorkerState } from "../state.js";
import { callLlm } from "../tools/openclaw.js";
import { runReactWorker } from "./react-worker.js";

type WorkerState = typeof SwarmWorkerState.State;

// Cap on the raw-transcript fallback used when a blocked worker has no escalation
// query/response to summarize, so the full glued transcript never flows through
// the firewall into the architect prompt.
const MAX_BLOCKED_FALLBACK_CHARS = 600;

export const codeExplorer = (state: WorkerState) => runReactWorker(state, WorkerKind.CODE_EXPLORER);
export const infraOps = (state: WorkerState) => runReactWorker(state, WorkerKind.INFRA_OPS);
export const webResearcher = (state: WorkerState) => runReactWorker(state, WorkerKind.WEB_RESEARCHER);

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

// LLM classifier that routes a subtask to one worker, seeded by (and falling back
// to) the upstream heuristic. Runs once per swarm invocation; escalation routes go
// back to the worker, not here.
export const leadDelegator = async (state: WorkerState) => {
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
        // The heuristic is a deterministic fallback, so a transient model failure
        // should not abort an inspection the selected worker can still perform.
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

export const smeOracle = async (state: WorkerState) => {
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

// Environment failures need out-of-band human resolution. The swarm is compiled
// with a checkpointer and the caller runs a resume loop, so `interrupt()` pauses
// here and resumes with the human's decision; `abort` reproduces the prior
// graceful-block behavior. Nothing runs before the interrupt, so re-executing this
// node on resume is safe.
export const humanGate = (state: WorkerState) => {
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

    // Human resolved the environment issue out-of-band: hand their guidance to the
    // worker as escalation context and route back for a bounded retry.
    return {
        status: WorkerStatus.WORKING,
        failureType: FailureType.NONE,
        escalationResponse: resolution.guidance,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
    };
};

export const workerCompress = async (state: WorkerState) => {
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

export const blocked = (state: WorkerState) => {
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
