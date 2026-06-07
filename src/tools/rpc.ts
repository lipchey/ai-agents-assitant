import { isToolName } from "../consts";
import type { JsonObject, ToolArgs, ToolCallOptions } from "../types/tools";
import { invokeGatewayTool } from "./http.ts";
import { getDefaultToolRegistry } from "./registry.ts";
import { unwrapToolResult } from "./results.ts";

/* Caller-side control args are not part of Gateway tool schemas. */
const omitControlArgs = (args: ToolArgs): JsonObject => {
    const { requireConfirmation, subtask, ...rest } = args;
    void requireConfirmation;
    void subtask;
    return rest;
};

export const openclawRpc = async (
    tool: string,
    args: ToolArgs,
    options?: ToolCallOptions,
): Promise<JsonObject> => {
    if (isToolName(tool)) {
        return unwrapToolResult(await getDefaultToolRegistry().invoke(tool, args, options));
    }

    return invokeGatewayTool(tool, omitControlArgs(args), options);
};
