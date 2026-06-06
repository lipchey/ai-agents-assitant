/* humanGate always interrupts; resolver availability decides retry vs abort. */

import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import type {
    HitlDrivableGraph,
    HitlGraphRunConfig,
    HitlInterruptPayload,
    HitlResolution,
    HitlResolver,
} from "./types/hitl/index.js";

export type {
    HitlDrivableGraph,
    HitlGraphRunConfig,
    HitlInterruptPayload,
    HitlResolution,
    HitlResolver,
} from "./types/hitl/index.js";

export const HITL_RESOLVER_CONFIG_KEY = "hitlResolver";

/* Defensive cap beyond the swarm's own escalation bound. */
const DEFAULT_MAX_HITL_ROUNDS = 6;

export const autoAbortResolver: HitlResolver = async () => ({ action: "abort" });

/* Non-TTY runs must never hang waiting for operator input. */
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

export const readHitlResolver = (config?: LangGraphRunnableConfig): HitlResolver => {
    const resolver = config?.configurable?.[HITL_RESOLVER_CONFIG_KEY];
    return typeof resolver === "function" ? (resolver as HitlResolver) : autoAbortResolver;
};

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

    /* Force termination if a pathological graph still interrupts after the cap. */
    if (isInterrupted<HitlInterruptPayload>(result)) {
        const abort: HitlResolution = { action: "abort" };
        result = await graph.invoke(new Command({ resume: abort }), config);
    }

    return result;
};
