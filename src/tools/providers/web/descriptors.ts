import { BuiltInToolId, ToolCapability, ToolErrorKind, ToolName, ToolProviderName, WorkerKind } from "../../../consts";
import { errorMessage, readString } from "../../../shared";
import type { ToolArgs, ToolCallContext, ToolDescriptor, ToolResult } from "../../../types/tools";
import { ToolError } from "../../errors.ts";
import { createToolResult } from "../../results.ts";
import { runWebLookupWithFallback } from "../../web-search.ts";

const invokeWebLookup = async (args: ToolArgs, context?: ToolCallContext): Promise<ToolResult> => {
    try {
        return createToolResult(
            ToolProviderName.WEB,
            BuiltInToolId.WEB_LOOKUP,
            await runWebLookupWithFallback(args, context),
            ToolName.WEB_LOOKUP,
        );
    } catch (error) {
        if (error instanceof ToolError) {
            throw new ToolError(error.kind, error.message, {
                cause: error,
                provider: error.provider ?? ToolProviderName.WEB,
                toolId: error.toolId ?? BuiltInToolId.WEB_LOOKUP,
            });
        }
        throw new ToolError(ToolErrorKind.EXECUTION, errorMessage(error), {
            cause: error,
            provider: ToolProviderName.WEB,
            toolId: BuiltInToolId.WEB_LOOKUP,
        });
    }
};

export const webDescriptors: readonly ToolDescriptor[] = [
    {
        id: BuiltInToolId.WEB_LOOKUP,
        aliases: [ToolName.WEB_LOOKUP],
        capabilities: [ToolCapability.EXTERNAL_NETWORK],
        suggestedKinds: [WorkerKind.WEB_RESEARCHER],
        description: '{"query":"focused search query"}: run a web search with Tavily-to-DuckDuckGo fallback.',
        validate: (rawArgs) => {
            const query = readString(rawArgs.query) ?? readString(rawArgs.subtask);
            if (!query) {
                return { ok: false, error: 'web_lookup requires a "query".' };
            }
            return { ok: true, alias: ToolName.WEB_LOOKUP, args: { query } };
        },
        invoke: invokeWebLookup,
    },
];
