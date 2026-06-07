import {
    BuiltInToolId,
    ToolCapability,
    ToolName,
    ToolProviderName,
    WorkerKind,
} from "../../../consts";
import { readString } from "../../../shared";
import type { ToolDescriptor } from "../../../types/tools";
import { createToolResult } from "../../results.ts";
import { runWebLookupWithFallback } from "../../web-search.ts";

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
        invoke: async (args, context) => createToolResult(
            ToolProviderName.WEB,
            BuiltInToolId.WEB_LOOKUP,
            await runWebLookupWithFallback(args, context),
            ToolName.WEB_LOOKUP,
        ),
    },
];
