// Generic bounded ReAct executor backing every Swarm worker. The planner picks
// ONE tool per step, reads the real observation, and decides the next step, up to
// a hard step/failure budget. Recoverable (reasoning) errors are fed back in-loop;
// environment failures break out to the human gate.
import { ModelRole, RESPONSE_FORMAT_JSON, ToolName } from "../constants.js";
import { FailureType, WorkerKind, WorkerStatus } from "../enums.js";
import { errorMessage, readString, safeJson, stringifyPretty, truncate } from "../shared/text.js";
import { emptyUsage, mergeUsage, usageFromLlm, type UsageStats } from "../shared/usage.js";
import { SwarmWorkerState, type ToolCallRecord } from "../state.js";
import { callLlm, openclawRpc, storeArtifact, type LlmCallResult } from "../tools/openclaw.js";
import { WORKER_PROMPTS, WORKER_USAGE_KEY } from "./tool-catalog.js";
import { classifyFailure, parseReactDecision, readExitCode, sanitizeToolArgs } from "./tool-validation.js";

type WorkerState = typeof SwarmWorkerState.State;

const MAX_REACT_STEPS = 6;
const MAX_REACT_TOOL_FAILURES = 3;
// Caps on the text fed BACK to the planner (full output still goes to artifacts).
const MAX_OBSERVATION_CHARS = 1_600;
const MAX_PRIOR_TRANSCRIPT_CHARS = 8_000;
const MAX_ACTION_SUMMARY_CHARS = 200;
const SHELL_EXEC_TIMEOUT_S = 120;
const TOOL_TIMEOUT_S = 45;

type ReactStep = {
    thought: string;
    summary: string;
    observation: string;
    ok: boolean;
};

const buildWorkerContext = (state: WorkerState, steps: ReactStep[]): string => {
    const guidance = readString(state.escalationResponse);
    const priorObservations = readString(state.rawToolOutput);
    const transcript = steps.length === 0
        ? "(no steps yet — choose your first action)"
        : steps
            .map((step, index) => [
                `Step ${index + 1} thought: ${step.thought || "(none)"}`,
                `Step ${index + 1} action: ${step.summary}`,
                `Step ${index + 1} observation (${step.ok ? "ok" : "error"}):\n${step.observation}`,
            ].join("\n"))
            .join("\n\n");

    return [
        `SUBTASK:\n${state.subtask}`,
        guidance ? `ESCALATION GUIDANCE (apply this first):\n${guidance}` : "",
        priorObservations ? `EARLIER ATTEMPT OBSERVATIONS:\n${truncate(priorObservations, MAX_PRIOR_TRANSCRIPT_CHARS)}` : "",
        `STEP BUDGET: ${MAX_REACT_STEPS} total; used ${steps.length}.`,
        `PROGRESS THIS ATTEMPT:\n${transcript}`,
        "Decide the next single step. Respond with ONE JSON object only.",
    ].filter(Boolean).join("\n\n");
};

const composeRaw = (rawOutputs: string[], finalSummary: string): string => {
    const parts = [...rawOutputs];
    if (finalSummary) {
        parts.push(`### Final\n${finalSummary}`);
    }
    return parts.join("\n\n");
};

export const runReactWorker = async (state: WorkerState, kind: WorkerKind) => {
    const system = WORKER_PROMPTS[kind];
    const usageKey = WORKER_USAGE_KEY[kind];
    const attempts = (state.attempts ?? 0) + 1;

    const steps: ReactStep[] = [];
    const rawOutputs: string[] = [];
    const producedArtifacts: Record<string, string> = {};
    const toolCalls: ToolCallRecord[] = [];

    let usage = emptyUsage();
    let toolFailures = 0;
    let successfulToolCalls = 0;
    let finalSummary = "";

    const escalate = (failureType: FailureType, escalationQuery: string) => ({
        status: WorkerStatus.ESCALATING,
        failureType,
        attempts,
        escalationQuery,
        rawToolOutput: composeRaw(rawOutputs, finalSummary),
        producedArtifacts,
        toolCalls,
        totalCost: usage.cost,
        totalTokens: usage.tokens,
        usageStats: { [usageKey]: usage } satisfies UsageStats,
    });

    for (let step = 0; step < MAX_REACT_STEPS; step += 1) {
        let planResult: LlmCallResult;
        try {
            planResult = await callLlm(ModelRole.WORKER, system, buildWorkerContext(state, steps), {
                maxTokens: 700,
                responseFormat: RESPONSE_FORMAT_JSON,
                thinking: "disabled",
            });
        } catch (error) {
            // A planner-call failure (gateway/timeout/etc.) is an environment problem:
            // escalate gracefully through the human gate rather than crashing the run.
            const message = errorMessage(error);
            return escalate(classifyFailure(message), `Worker planner call failed: ${message}`);
        }
        usage = mergeUsage(usage, usageFromLlm(planResult));

        const decision = parseReactDecision(planResult.content);
        if (decision.kind === "final") {
            finalSummary = decision.final;
            break;
        }

        const actionSummary = truncate(`${decision.tool} ${safeJson(decision.args)}`, MAX_ACTION_SUMMARY_CHARS);
        const sanitized = sanitizeToolArgs(kind, decision.tool, decision.args);
        if (!sanitized.ok) {
            // Recoverable: hand the validation error back so the planner can fix the
            // call. Counts toward the failure budget so it cannot spin.
            toolFailures += 1;
            steps.push({ thought: decision.thought, summary: actionSummary, observation: sanitized.error, ok: false });
            toolCalls.push({ tool: decision.tool, ok: false, error: sanitized.error });
            if (toolFailures >= MAX_REACT_TOOL_FAILURES) {
                return escalate(FailureType.REASONING, `Repeated invalid tool calls; last: ${sanitized.error}`);
            }
            continue;
        }

        try {
            const result = await openclawRpc(decision.tool, sanitized.args, {
                timeoutS: decision.tool === ToolName.SHELL_EXEC ? SHELL_EXEC_TIMEOUT_S : TOOL_TIMEOUT_S,
                idempotencyKey: `${kind}-${attempts}-${step}`,
                maxRetries: 1,
            });

            const serialized = stringifyPretty(result);
            const artifact = await storeArtifact(serialized);
            producedArtifacts[`${decision.tool}-${step}`] = artifact;
            rawOutputs.push(`### Step ${step + 1}: ${actionSummary}\n${serialized}`);
            toolCalls.push({ tool: decision.tool, ok: true, artifact });
            successfulToolCalls += 1;

            // A non-zero shell exit (e.g. a failing typecheck) is a legitimate finding
            // to report, not a worker failure — surface it as an observation.
            const exitCode = readExitCode(result);
            const observationNote = decision.tool === ToolName.SHELL_EXEC && exitCode !== undefined && exitCode !== 0
                ? `[non-zero exit ${exitCode}]\n`
                : "";
            steps.push({
                thought: decision.thought,
                summary: actionSummary,
                observation: `${observationNote}${truncate(serialized, MAX_OBSERVATION_CHARS)}`,
                ok: true,
            });
        } catch (error) {
            const message = errorMessage(error);
            if (classifyFailure(message) === FailureType.ENVIRONMENT) {
                // Out-of-band issue (missing binary, gateway, permission): stop and route
                // to the human gate, preserving the SOS escalation protocol.
                toolCalls.push({ tool: decision.tool, ok: false, error: message });
                return escalate(FailureType.ENVIRONMENT, message);
            }
            // Recoverable reasoning error: feed it back and let the worker adapt.
            toolFailures += 1;
            steps.push({ thought: decision.thought, summary: actionSummary, observation: truncate(message, MAX_OBSERVATION_CHARS), ok: false });
            toolCalls.push({ tool: decision.tool, ok: false, error: message });
            if (toolFailures >= MAX_REACT_TOOL_FAILURES) {
                return escalate(FailureType.REASONING, message);
            }
        }
    }

    // Neither a final summary nor any successful tool call: ask the SME oracle for
    // reasoning help rather than returning an empty DONE.
    if (!finalSummary && successfulToolCalls === 0) {
        return escalate(
            FailureType.REASONING,
            `Worker ${kind} produced no usable result within ${MAX_REACT_STEPS} steps for subtask: ${state.subtask}`,
        );
    }

    return {
        status: WorkerStatus.DONE,
        failureType: FailureType.NONE,
        attempts,
        rawToolOutput: composeRaw(rawOutputs, finalSummary),
        producedArtifacts,
        toolCalls,
        totalCost: usage.cost,
        totalTokens: usage.tokens,
        usageStats: { [usageKey]: usage } satisfies UsageStats,
    };
};
