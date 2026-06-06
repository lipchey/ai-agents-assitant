// Web search failover: Tavily primary, DuckDuckGo fallback.
//
// OpenClaw's managed `web_search` resolves to a SINGLE provider with no per-call
// override and no runtime failover (its native fallback only covers a missing API
// key, in a fixed order). To get real "Tavily first, fallback on any failure" we
// drive the failover here:
//   1. Primary  -> Tavily's `tavily_search` tool in rich mode (advanced depth + AI answer).
//   2. Fallback -> the generic `web_search` tool (pinned to DuckDuckGo in config:
//      key-free, no geo-restriction) on ANY Tavily error/timeout OR empty result.
import { FALLBACK_PROVIDER_LABEL, ToolName, WEB_SEARCH_MAX_RESULTS } from "../constants.js";
import { errorMessage, readString } from "../shared/text.js";
import { OpenClawError } from "./errors.js";
import { invokeGatewayTool } from "./http.js";
import type { JsonObject, OpenClawRpcArgs, OpenClawRpcOptions } from "./types.js";

const isNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

const readJsonObject = (value: unknown): JsonObject | undefined => {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
};

// OpenClaw plugin tools return { content: [...human text...], details: payload }.
// `content` is non-empty even with zero hits, so emptiness must prefer `details`.
const webSearchPayload = (result: JsonObject): JsonObject => readJsonObject(result.details) ?? result;

// Usable when the payload carries an AI answer/summary or at least one result row.
// Providers differ in shape, so probe top-level arrays plus one nested level.
const webSearchResultIsEmpty = (result: JsonObject): boolean => {
    const payload = webSearchPayload(result);
    if (readString(payload.answer) || readString(payload.summary)) {
        return false;
    }
    for (const value of Object.values(payload)) {
        if (isNonEmptyArray(value)) {
            return false;
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
            for (const nested of Object.values(value as JsonObject)) {
                if (isNonEmptyArray(nested)) {
                    return false;
                }
            }
        }
    }
    return true;
};

export const runWebLookupWithFallback = async (
    args: OpenClawRpcArgs,
    options?: OpenClawRpcOptions,
): Promise<JsonObject> => {
    const query = readString(args.query) ?? readString(args.subtask);
    if (!query) {
        throw new OpenClawError("web_lookup requires a query.");
    }

    let tavilyFailure: string;
    try {
        const tavily = await invokeGatewayTool(
            ToolName.TAVILY_SEARCH,
            { query, search_depth: "advanced", include_answer: true, max_results: WEB_SEARCH_MAX_RESULTS },
            options,
        );
        if (!webSearchResultIsEmpty(tavily)) {
            return { ...tavily, searchProvider: "tavily" };
        }
        tavilyFailure = "tavily returned no results";
    } catch (error) {
        tavilyFailure = errorMessage(error);
    }

    try {
        const fallback = await invokeGatewayTool(
            ToolName.WEB_SEARCH,
            { query, count: Math.min(WEB_SEARCH_MAX_RESULTS, 10) },
            options,
        );
        const fallbackPayload = webSearchPayload(fallback);
        const fallbackProvider = readString(fallback.provider)
            ?? readString(fallbackPayload.provider)
            ?? FALLBACK_PROVIDER_LABEL;
        return { ...fallback, searchProvider: fallbackProvider, tavilyFallbackReason: tavilyFailure };
    } catch (fallbackError) {
        throw new OpenClawError(
            `web_lookup failed: tavily(${tavilyFailure}); ${FALLBACK_PROVIDER_LABEL}(${errorMessage(fallbackError)}).`,
            { cause: fallbackError },
        );
    }
};
