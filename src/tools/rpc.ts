import { ToolName } from "../consts";
import type { JsonObject, OpenClawRpcArgs, OpenClawRpcOptions } from "../types/tools";
import { OpenClawError } from "./errors.ts";
import { invokeGatewayTool } from "./http.ts";
import { runLocalPseudoTool } from "./local-tools.ts";
import { runWebLookupWithFallback } from "./web-search.ts";

/* Caller-side control args are not part of Gateway tool schemas. */
const omitControlArgs = (args: OpenClawRpcArgs): JsonObject => {
    const { requireConfirmation, subtask, ...rest } = args;
    void requireConfirmation;
    void subtask;
    return rest;
};

export const openclawRpc = async (
    tool: string,
    args: OpenClawRpcArgs,
    options?: OpenClawRpcOptions,
): Promise<JsonObject> => {
    if (args.requireConfirmation) {
        throw new OpenClawError(`HITL_REQUIRED: confirmation required before executing ${tool}.`);
    }

    const localResult = await runLocalPseudoTool(tool, args, options);
    if (localResult) {
        return localResult;
    }

    if (tool === ToolName.WEB_LOOKUP) {
        return runWebLookupWithFallback(args, options);
    }

    return invokeGatewayTool(tool, omitControlArgs(args), options);
};
