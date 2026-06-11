import { Command, INTERRUPT, isInterrupted } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_HITL_ROUNDS, HITL_THREAD_ID_PREFIX, HitlResolutionAction, THREAD_ID_CONFIG_KEY } from "../consts";
import type {
    HitlDrivableGraph,
    HitlGraphRunConfig,
    HitlInterruptPayload,
    HitlResolution,
    HitlResolver,
} from "../types/hitl";

export const driveSwarmWithHitl = async <TInput, TState>(
    graph: HitlDrivableGraph<TInput, TState>,
    initialInput: TInput,
    resolver: HitlResolver,
    options?: { threadId?: string; maxRounds?: number; configurable?: Record<string, unknown> },
): Promise<TState> => {
    /* Extra configurable keys (e.g. the active profile) ride into the sub-graph;
       the thread id wins so an isolated checkpoint per run is never overridden. */
    const config: HitlGraphRunConfig = {
        configurable: {
            ...options?.configurable,
            [THREAD_ID_CONFIG_KEY]: options?.threadId ?? `${HITL_THREAD_ID_PREFIX}${randomUUID()}`,
        },
    };
    const maxRounds = options?.maxRounds ?? DEFAULT_MAX_HITL_ROUNDS;

    let result = await graph.invoke(initialInput, config);

    for (let round = 0; round < maxRounds && isInterrupted<HitlInterruptPayload>(result); round += 1) {
        const request = result[INTERRUPT]?.[0]?.value;
        const resolution: HitlResolution = request ? await resolver(request) : { action: HitlResolutionAction.ABORT };
        result = await graph.invoke(new Command({ resume: resolution }), config);
    }

    /* Force termination if a pathological graph still interrupts after the cap. */
    if (isInterrupted<HitlInterruptPayload>(result)) {
        const abort: HitlResolution = { action: HitlResolutionAction.ABORT };
        result = await graph.invoke(new Command({ resume: abort }), config);
    }

    return result;
};
