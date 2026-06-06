// Human-in-the-loop (HITL) channel for the Swarm sub-graph.
//
// Environment failures (missing binary, permissions, gateway/timeout) cannot be
// fixed by another model pass — they need out-of-band human action. The swarm's
// `humanGate` node now calls LangGraph `interrupt()` to pause for that action;
// for the interrupt to actually pause (instead of throwing) the swarm must be
// compiled with a checkpointer AND the caller must run a resume loop. This module
// provides both the caller-side resume driver (`driveSwarmWithHitl`) and the
// pluggable resolver that decides how each interrupt is answered.
//
// Availability is handled at the resolver, not the node: `humanGate` ALWAYS
// interrupts, and the resolver decides whether a human answers (interactive TTY)
// or the run degrades to the previous graceful-block behavior (auto-abort in
// non-interactive environments). This keeps the swarm graph identical in both
// modes.

import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import type { FailureType, WorkerKind } from "./enums.js";

// Payload surfaced by `humanGate` via `interrupt()`. Plain JSON so it survives
// checkpoint serialization.
export type HitlInterruptPayload = {
    kind: "environment_failure";
    failureType: FailureType;
    workerKind: WorkerKind;
    subtask: string;
    reason: string;
    escalationAttempt: number;
};

// Decision handed back to `humanGate` via `Command({ resume })`.
// - "retry": the human fixed the issue out-of-band; re-run the worker (bounded by
//   the swarm's MAX_ESCALATION_ATTEMPTS) using `guidance` as escalation context.
// - "abort": no human available or the human gave up; block gracefully.
export type HitlResolution =
    | { action: "retry"; guidance: string }
    | { action: "abort"; guidance?: string };

export type HitlResolver = (request: HitlInterruptPayload) => Promise<HitlResolution>;

// Key under `config.configurable` used to thread the resolver from the caller
// (index.ts) into the main-graph `swarmNode` without putting a non-serializable
// function into graph state.
export const HITL_RESOLVER_CONFIG_KEY = "hitlResolver";

// Defensive cap on resume rounds. The swarm's own MAX_ESCALATION_ATTEMPTS already
// bounds how many times `humanGate` can be reached; this only guards against a
// pathological node that interrupts more often than that.
const DEFAULT_MAX_HITL_ROUNDS = 6;

// Non-interactive default: there is no human to ask, so reproduce the previous
// graceful-block behavior.
export const autoAbortResolver: HitlResolver = async () => ({ action: "abort" });

// Interactive resolver. Prompts the operator on the terminal. Falls back to
// auto-abort when stdin is not a TTY (CI, piped input) so headless runs never
// hang waiting on input that can never arrive.
export const createStdinHitlResolver = (): HitlResolver => {
    if (!process.stdin.isTTY) {
        return autoAbortResolver;
    }
    return async (request) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
            console.log("\n=== HUMAN-IN-THE-LOOP: environment failure ===");
            console.log(`Worker:   ${request.workerKind}`);
            console.log(`Failure:  ${request.failureType}`);
            console.log(`Subtask:  ${request.subtask}`);
            console.log(`Error:    ${request.reason}`);
            console.log(`Attempt:  #${request.escalationAttempt}`);
            const answer = (await rl.question(
                "Resolve the issue out-of-band, then enter retry guidance — or leave blank to abort: ",
            )).trim();
            return answer ? { action: "retry", guidance: answer } : { action: "abort" };
        } finally {
            rl.close();
        }
    };
};

// Read the resolver the caller attached to the run config. Defaults to
// auto-abort so a missing/invalid resolver never crashes the graph.
export const readHitlResolver = (config?: LangGraphRunnableConfig): HitlResolver => {
    const resolver = config?.configurable?.[HITL_RESOLVER_CONFIG_KEY];
    return typeof resolver === "function" ? (resolver as HitlResolver) : autoAbortResolver;
};

type HitlGraphRunConfig = { configurable: { thread_id: string }; recursionLimit?: number };

// Minimal structural view of a checkpointed, resumable compiled graph. The real
// swarm's `invoke` signature satisfies this; the smoke test supplies a fake.
export interface HitlDrivableGraph<TInput, TState> {
    invoke(input: TInput | Command, config: HitlGraphRunConfig): Promise<TState>;
}

// Caller-side resume loop. Invokes the graph; while it is paused on an
// `interrupt()`, asks the resolver for a decision and resumes with it. Returns
// the graph's final (non-interrupted) state.
export const driveSwarmWithHitl = async <TInput, TState>(
    graph: HitlDrivableGraph<TInput, TState>,
    initialInput: TInput,
    resolver: HitlResolver,
    options?: { threadId?: string; maxRounds?: number },
): Promise<TState> => {
    const config: HitlGraphRunConfig = {
        configurable: { thread_id: options?.threadId ?? `swarm-${randomUUID()}` },
    };
    const maxRounds = options?.maxRounds ?? DEFAULT_MAX_HITL_ROUNDS;

    let result = await graph.invoke(initialInput, config);

    for (let round = 0; round < maxRounds && isInterrupted<HitlInterruptPayload>(result); round += 1) {
        const request = result[INTERRUPT]?.[0]?.value;
        const resolution: HitlResolution = request ? await resolver(request) : { action: "abort" };
        result = await graph.invoke(new Command({ resume: resolution }), config);
    }

    // Still paused after the cap: force a final abort so the graph terminates and
    // surfaces a BLOCKED summary instead of leaving the run hung.
    if (isInterrupted<HitlInterruptPayload>(result)) {
        const abort: HitlResolution = { action: "abort" };
        result = await graph.invoke(new Command({ resume: abort }), config);
    }

    return result;
};
