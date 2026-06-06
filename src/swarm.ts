import { END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import { FailureType, WorkerKind, WorkerStatus } from "./enums.js";
import type { HitlInterruptPayload, HitlResolution } from "./hitl.js";
import { SystemPrompts } from "./prompts.js";
import { SwarmWorkerState, type ToolCallRecord, type UsageBreakdown } from "./state.js";
import {
    SAFE_DIRECT_EXEC_COMMANDS,
    callLlm,
    openclawRpc,
    storeArtifact,
    type LlmCallResult,
    type OpenClawRpcArgs,
} from "./tools/openclaw.js";

const MAX_ESCALATION_ATTEMPTS = 2;
// Per-worker call caps. MAX_REACT_STEPS bounds how many LLM-planned tool steps a
// single worker invocation may run; MAX_REACT_TOOL_FAILURES bounds how many
// recoverable (reasoning) tool errors it may absorb before giving up and routing
// to the SME oracle. Both keep a misbehaving planner from burning tokens or
// spinning, in addition to the swarm-level MAX_ESCALATION_ATTEMPTS.
const MAX_REACT_STEPS = 6;
const MAX_REACT_TOOL_FAILURES = 3;
// Caps on the text fed BACK to the planner (full output still goes to artifacts).
const MAX_OBSERVATION_CHARS = 1_600;
const MAX_PRIOR_TRANSCRIPT_CHARS = 8_000;
const MAX_ACTION_SUMMARY_CHARS = 200;
// Cap on the raw-transcript fallback used when a blocked worker has no
// escalation query/response to summarize. Keeps the full glued transcript from
// flowing through the firewall into the architect prompt on the rare path where
// nothing structured was captured.
const MAX_BLOCKED_FALLBACK_CHARS = 600;

type WorkerState = typeof SwarmWorkerState.State;

// Tools each worker kind may call. The local OpenClaw adapters enforce path
// bounds + command allowlists regardless, but restricting the catalog per worker
// keeps the planner focused and lets us reject an out-of-scope tool with a clean,
// recoverable observation instead of a hard failure.
const WORKER_TOOLS: Record<WorkerKind, readonly string[]> = {
    [WorkerKind.CODE_EXPLORER]: ["find_files", "grep_code", "ast_read"],
    [WorkerKind.INFRA_OPS]: ["shell_exec", "find_files", "grep_code", "ast_read"],
    [WorkerKind.WEB_RESEARCHER]: ["web_lookup"],
};

const WORKER_PROMPTS: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: SystemPrompts.codeExplorer,
    [WorkerKind.INFRA_OPS]: SystemPrompts.infraOps,
    [WorkerKind.WEB_RESEARCHER]: SystemPrompts.webResearcher,
};

// Telemetry key under usageStats for each worker's planner LLM spend.
const WORKER_USAGE_KEY: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: "codeExplorer",
    [WorkerKind.INFRA_OPS]: "infraOps",
    [WorkerKind.WEB_RESEARCHER]: "webResearcher",
};

const usageFromLlm = (result: LlmCallResult): UsageBreakdown => ({
    cost: result.cost,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedInputTokens: result.cachedInputTokens,
    cacheMissInputTokens: result.cacheMissInputTokens,
    cacheWriteInputTokens: result.cacheWriteInputTokens,
});

const emptyUsage = (): UsageBreakdown => ({
    cost: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheMissInputTokens: 0,
    cacheWriteInputTokens: 0,
});

const mergeUsage = (left: UsageBreakdown, right: UsageBreakdown): UsageBreakdown => ({
    cost: left.cost + right.cost,
    tokens: left.tokens + right.tokens,
    inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0),
    cachedInputTokens: (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0),
    cacheMissInputTokens: (left.cacheMissInputTokens ?? 0) + (right.cacheMissInputTokens ?? 0),
    cacheWriteInputTokens: (left.cacheWriteInputTokens ?? 0) + (right.cacheWriteInputTokens ?? 0),
});

const stringifyToolResult = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const safeJson = (value: unknown): string => {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const truncate = (value: string, maxChars: number): string => {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
};

const readRecord = (value: unknown): Record<string, unknown> | null => {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
};

const readArgString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
};

const extractJsonObject = (text: string): unknown => {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
    const candidate = fenced?.[1] ?? text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end < start) {
        return null;
    }
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
};

const readExitCode = (value: unknown): number | undefined => {
    const record = readRecord(value);
    const details = readRecord(record?.details);
    const exitCode = details?.exitCode ?? record?.exitCode;
    return typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : undefined;
};

const classifyFailure = (errorMessage: string): FailureType => {
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

// --- ReAct planning: parse one step decision from the planner model. ---------

type ReactDecision =
    | { kind: "act"; thought: string; tool: string; args: OpenClawRpcArgs }
    | { kind: "final"; thought: string; final: string };

export const parseReactDecision = (content: string): ReactDecision => {
    const parsed = readRecord(extractJsonObject(content));
    const thought = typeof parsed?.thought === "string" ? parsed.thought.trim() : "";
    const action = readRecord(parsed?.action);
    const tool = readArgString(action?.tool);
    if (tool) {
        const rawArgs = readRecord(action?.args);
        return { kind: "act", thought, tool, args: (rawArgs ?? {}) as OpenClawRpcArgs };
    }
    const final = typeof parsed?.final === "string" ? parsed.final.trim() : "";
    if (final) {
        return { kind: "final", thought, final };
    }
    // No structured action and no `final`: treat the whole reply as the final
    // summary so a stray prose response converges instead of looping the budget.
    return { kind: "final", thought, final: content.trim() };
};

// --- Tool argument validation: restrict per worker + enforce the allowlist. ---

type SanitizedAction =
    | { ok: true; args: OpenClawRpcArgs }
    | { ok: false; error: string };

export const sanitizeToolArgs = (
    kind: WorkerKind,
    tool: string,
    rawArgs: OpenClawRpcArgs,
): SanitizedAction => {
    if (!WORKER_TOOLS[kind].includes(tool)) {
        return { ok: false, error: `Tool "${tool}" is not available to ${kind}. Allowed: ${WORKER_TOOLS[kind].join(", ")}.` };
    }

    switch (tool) {
        case "find_files": {
            const pattern = readArgString(rawArgs.pattern) ?? "src/**/*.ts";
            const path = readArgString(rawArgs.path) ?? ".";
            const limit = clampInt(rawArgs.limit, 100, 1, 500);
            return { ok: true, args: { path, pattern, limit } };
        }
        case "grep_code": {
            const pattern = readArgString(rawArgs.pattern) ?? readArgString(rawArgs.query);
            if (!pattern) {
                return { ok: false, error: 'grep_code requires a non-empty "pattern".' };
            }
            const path = readArgString(rawArgs.path) ?? ".";
            const limit = clampInt(rawArgs.limit, 80, 1, 500);
            return {
                ok: true,
                args: {
                    path,
                    pattern,
                    ignoreCase: rawArgs.ignoreCase !== false,
                    literal: rawArgs.literal === true,
                    limit,
                },
            };
        }
        case "ast_read": {
            const path = readArgString(rawArgs.path) ?? readArgString(rawArgs.subtask);
            if (!path) {
                return { ok: false, error: 'ast_read requires a "path" to a file.' };
            }
            return { ok: true, args: { path } };
        }
        case "shell_exec": {
            const command = readArgString(rawArgs.command);
            if (!command) {
                return { ok: false, error: 'shell_exec requires a "command".' };
            }
            if (!SAFE_DIRECT_EXEC_COMMANDS.has(command)) {
                return {
                    ok: false,
                    error: `Command "${command}" is not allowlisted. Choose exactly one of: ${[...SAFE_DIRECT_EXEC_COMMANDS].join(" | ")}.`,
                };
            }
            return { ok: true, args: { command, timeout: 120 } };
        }
        case "web_lookup": {
            const query = readArgString(rawArgs.query) ?? readArgString(rawArgs.subtask);
            if (!query) {
                return { ok: false, error: 'web_lookup requires a "query".' };
            }
            return { ok: true, args: { query } };
        }
        default:
            return { ok: false, error: `Tool "${tool}" is not available to ${kind}.` };
    }
};

// --- ReAct executor ----------------------------------------------------------

type ReactStep = {
    thought: string;
    summary: string;
    observation: string;
    ok: boolean;
};

const buildWorkerContext = (state: WorkerState, steps: ReactStep[]): string => {
    const guidance = readArgString(state.escalationResponse);
    const priorObservations = readArgString(state.rawToolOutput);
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

const runReactWorker = async (state: WorkerState, kind: WorkerKind) => {
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
        usageStats: { [usageKey]: usage },
    });

    for (let step = 0; step < MAX_REACT_STEPS; step += 1) {
        let planResult: LlmCallResult;
        try {
            planResult = await callLlm(
                "worker",
                system,
                buildWorkerContext(state, steps),
                { maxTokens: 700, responseFormat: "json_object", thinking: "disabled" },
            );
        } catch (error) {
            // A planner-call failure (gateway/timeout/etc.) is an environment
            // problem: escalate gracefully through the human gate rather than
            // crashing the whole run.
            const message = error instanceof Error ? error.message : String(error);
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
            // Recoverable: hand the validation error back so the planner can fix
            // the call. Counts toward the failure budget so it cannot spin.
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
                timeoutS: decision.tool === "shell_exec" ? 120 : 45,
                idempotencyKey: `${kind}-${attempts}-${step}`,
                maxRetries: 1,
            });

            const serialized = stringifyToolResult(result);
            const artifact = await storeArtifact(serialized);
            producedArtifacts[`${decision.tool}-${step}`] = artifact;
            rawOutputs.push(`### Step ${step + 1}: ${actionSummary}\n${serialized}`);
            toolCalls.push({ tool: decision.tool, ok: true, artifact });
            successfulToolCalls += 1;

            // A non-zero shell exit (e.g. a failing typecheck) is a legitimate
            // finding to report, not a worker failure — surface it as an
            // observation so the worker can describe or investigate it further.
            const exitCode = readExitCode(result);
            const observationNote = decision.tool === "shell_exec" && exitCode !== undefined && exitCode !== 0
                ? `[non-zero exit ${exitCode}]\n`
                : "";
            steps.push({
                thought: decision.thought,
                summary: actionSummary,
                observation: `${observationNote}${truncate(serialized, MAX_OBSERVATION_CHARS)}`,
                ok: true,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failure = classifyFailure(message);
            if (failure === FailureType.ENVIRONMENT) {
                // Out-of-band issue (missing binary, gateway, permission): stop and
                // route to the human gate, preserving the SOS escalation protocol.
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

    // The worker produced neither a final summary nor any successful tool call:
    // ask the SME oracle for reasoning help rather than returning an empty DONE.
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
        usageStats: { [usageKey]: usage },
    };
};

// --- Worker nodes ------------------------------------------------------------

const codeExplorer = (state: WorkerState) => runReactWorker(state, WorkerKind.CODE_EXPLORER);
const infraOps = (state: WorkerState) => runReactWorker(state, WorkerKind.INFRA_OPS);
const webResearcher = (state: WorkerState) => runReactWorker(state, WorkerKind.WEB_RESEARCHER);

const parseWorkerKind = (content: string, fallback: WorkerKind): WorkerKind => {
    const parsed = readRecord(extractJsonObject(content));
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

// Lead delegator: an LLM classifier decides which worker handles the subtask,
// seeded by (and falling back to) the cheap heuristic chosen upstream. Runs once
// per swarm invocation; escalation routes go back to the worker, not here.
const leadDelegator = async (state: WorkerState) => {
    const seededKind = state.workerKind ?? WorkerKind.CODE_EXPLORER;
    let selectedKind = seededKind;
    let usage = emptyUsage();

    try {
        const result = await callLlm(
            "worker",
            SystemPrompts.leadDelegator,
            [
                `Subtask:\n${state.subtask}`,
                state.escalationResponse ? `Escalation guidance:\n${state.escalationResponse}` : "",
                `Heuristic suggestion: ${seededKind}`,
            ].filter(Boolean).join("\n\n"),
            { maxTokens: 120, responseFormat: "json_object", thinking: "disabled" },
        );
        selectedKind = parseWorkerKind(result.content, seededKind);
        usage = usageFromLlm(result);
    } catch {
        // The upstream heuristic is intentionally supplied as a deterministic
        // fallback, so a transient cheap-router/model failure should not abort a
        // repository inspection that the selected worker can still perform.
    }

    return {
        workerKind: selectedKind,
        status: WorkerStatus.WORKING,
        attempts: state.attempts ?? 0,
        escalationAttempts: state.escalationAttempts ?? 0,
        failureType: FailureType.NONE,
        totalCost: usage.cost,
        totalTokens: usage.tokens,
        usageStats: { leadDelegator: usage },
    };
};

const smeOracle = async (state: WorkerState) => {
    const result = await callLlm(
        "frontier",
        SystemPrompts.smeOracle,
        state.escalationQuery,
        { maxTokens: 900, reasoningEffort: "high", thinking: "enabled" },
    );
    return {
        escalationResponse: result.content,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { frontierSme: usageFromLlm(result) },
    };
};

export const humanGate = (state: WorkerState) => {
    // Environment failures (missing binary, permissions, gateway/timeout) need
    // out-of-band human resolution. The swarm is now compiled with a checkpointer
    // and the caller (main-graph swarmNode) runs a resume loop, so `interrupt()`
    // pauses execution here and resumes with the human's decision. If no human is
    // available the caller resolves with `abort`, which preserves the previous
    // graceful-block behavior (the failure detail still propagates up through the
    // firewall). Nothing runs before the interrupt, so re-executing this node on
    // resume is safe.
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

    // Human resolved the environment issue out-of-band: hand their guidance to
    // the worker as escalation context and route back for a bounded retry.
    return {
        status: WorkerStatus.WORKING,
        failureType: FailureType.NONE,
        escalationResponse: resolution.guidance,
        escalationAttempts: (state.escalationAttempts ?? 0) + 1,
    };
};

const workerCompress = async (state: WorkerState) => {
    const result = await callLlm(
        "firewall",
        SystemPrompts.workerCompress,
        state.rawToolOutput || JSON.stringify(state.toolCalls),
        { maxTokens: 1_200, responseFormat: "json_object", thinking: "disabled" },
    );
    return {
        workerSummary: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { firewall: usageFromLlm(result) },
    };
};

const delegateToWorker = (state: WorkerState): string => {
    const mapping: Record<WorkerKind, string> = {
        [WorkerKind.CODE_EXPLORER]: "codeExplorer",
        [WorkerKind.INFRA_OPS]: "infraOps",
        [WorkerKind.WEB_RESEARCHER]: "webResearcher",
    };
    return mapping[state.workerKind] ?? "codeExplorer";
};

const routeAfterWorker = (state: WorkerState): string => {
    if (state.status === WorkerStatus.DONE) {
        return "workerCompress";
    }
    if ((state.escalationAttempts ?? 0) >= MAX_ESCALATION_ATTEMPTS) {
        return "__blocked__";
    }
    if (state.failureType === FailureType.REASONING) {
        return "smeOracle";
    }
    return "humanGate";
};

const routeAfterSme = (state: WorkerState): string => {
    if (!state.escalationResponse) {
        return "__blocked__";
    }
    return delegateToWorker(state);
};

const routeAfterHuman = (state: WorkerState): string => {
    if (state.status === WorkerStatus.BLOCKED) {
        return "__blocked__";
    }
    return delegateToWorker(state);
};

const blocked = (state: WorkerState) => {
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

export const buildSwarm = () => {
    const graph = new StateGraph(SwarmWorkerState)
        .addNode("leadDelegator", leadDelegator)
        .addNode("codeExplorer", codeExplorer)
        .addNode("infraOps", infraOps)
        .addNode("webResearcher", webResearcher)
        .addNode("smeOracle", smeOracle)
        .addNode("humanGate", humanGate)
        .addNode("workerCompress", workerCompress)
        .addNode("blocked", blocked)
        .addEdge(START, "leadDelegator")
        .addConditionalEdges("leadDelegator", delegateToWorker, {
            codeExplorer: "codeExplorer",
            infraOps: "infraOps",
            webResearcher: "webResearcher",
        });

    const afterWorkerTargets = {
        smeOracle: "smeOracle",
        humanGate: "humanGate",
        workerCompress: "workerCompress",
        __blocked__: "blocked",
    } as const;

    graph
        .addConditionalEdges("codeExplorer", routeAfterWorker, afterWorkerTargets)
        .addConditionalEdges("infraOps", routeAfterWorker, afterWorkerTargets)
        .addConditionalEdges("webResearcher", routeAfterWorker, afterWorkerTargets);

    const workerTargets = {
        codeExplorer: "codeExplorer",
        infraOps: "infraOps",
        webResearcher: "webResearcher",
        __blocked__: "blocked",
    } as const;

    graph
        .addConditionalEdges("smeOracle", routeAfterSme, workerTargets)
        .addConditionalEdges("humanGate", routeAfterHuman, workerTargets)
        .addEdge("workerCompress", END)
        .addEdge("blocked", END);

    // A checkpointer is required for `humanGate`'s `interrupt()` to pause instead
    // of throw. Each `swarmNode` invocation builds a fresh swarm with its own
    // in-memory saver and thread id, so checkpoints never leak between runs.
    return graph.compile({ checkpointer: new MemorySaver() });
};
