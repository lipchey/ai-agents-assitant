/* humanGate always interrupts; resolver availability decides retry vs abort. */

import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { createInterface } from "node:readline/promises";
import { HITL_RESOLVER_CONFIG_KEY } from "../consts";
import type { HitlResolver } from "../types/hitl";

export { HITL_RESOLVER_CONFIG_KEY } from "../consts";

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
