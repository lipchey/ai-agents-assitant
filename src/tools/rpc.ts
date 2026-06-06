// Tool dispatch entrypoint. Routes a tool call to the right handler: local
// pseudo-tool adapters first, then the web-search failover, then the generic
// Gateway tool invocation.
import { ToolName } from "../constants.js";
import { OpenClawError } from "./errors.js";
import { invokeGatewayTool } from "./http.js";
import { runLocalPseudoTool } from "./local-tools.js";
import type { JsonObject, OpenClawRpcArgs, OpenClawRpcOptions } from "./types.js";
import { runWebLookupWithFallback } from "./web-search.js";

// Strip caller-side control args that must not reach the Gateway tool schema.
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
