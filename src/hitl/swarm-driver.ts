import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import type {
    HitlDrivableGraph,
    HitlGraphRunConfig,
    HitlInterruptPayload,
    HitlResolution,
    HitlResolver,
} from "../types/hitl/index.js";

/* Defensive cap beyond the swarm's own escalation bound. */
const DEFAULT_MAX_HITL_ROUNDS = 6;

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
