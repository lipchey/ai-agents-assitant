/* humanGate always interrupts; resolver availability decides retry vs abort. */

import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { createInterface } from "node:readline/promises";
import { HITL_RESOLVER_CONFIG_KEY, HitlResolutionAction } from "../consts";
import { getOutputWriter } from "../logging";
import type { HitlResolver } from "../types/hitl";
import type { OutputWriter } from "../types/logging.ts";

export const autoAbortResolver: HitlResolver = async () => ({ action: HitlResolutionAction.ABORT });

export type StdinHitlResolverOptions = {
    output?: OutputWriter;
    input?: NodeJS.ReadableStream;
    questionOutput?: NodeJS.WritableStream;
};

const inputIsTty = (input: NodeJS.ReadableStream): boolean =>
    (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY === true;

/* Non-TTY runs must never hang waiting for operator input. */
export const createStdinHitlResolver = (options: StdinHitlResolverOptions = {}): HitlResolver => {
    const input = options.input ?? process.stdin;
    if (!inputIsTty(input)) {
        return autoAbortResolver;
    }
    const output = options.output ?? getOutputWriter();
    const questionOutput = options.questionOutput ?? process.stdout;
    return async (request) => {
        const rl = createInterface({ input, output: questionOutput });
        try {
            output.line("\n=== HUMAN-IN-THE-LOOP: environment failure ===");
            output.line(`Worker:   ${request.workerKind}`);
            output.line(`Failure:  ${request.failureType}`);
            output.line(`Subtask:  ${request.subtask}`);
            output.line(`Error:    ${request.reason}`);
            output.line(`Attempt:  #${request.escalationAttempt}`);
            const answer = (
                await rl.question(
                    "Resolve the issue out-of-band, then enter retry guidance — or leave blank to abort: ",
                )
            ).trim();
            return answer
                ? { action: HitlResolutionAction.RETRY, guidance: answer }
                : { action: HitlResolutionAction.ABORT };
        } finally {
            rl.close();
        }
    };
};

export const readHitlResolver = (config?: LangGraphRunnableConfig): HitlResolver => {
    const resolver = config?.configurable?.[HITL_RESOLVER_CONFIG_KEY];
    return typeof resolver === "function" ? (resolver as HitlResolver) : autoAbortResolver;
};
