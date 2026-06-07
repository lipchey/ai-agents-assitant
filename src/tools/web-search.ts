/* OpenClaw web_search lacks provider override/runtime failover, so Tavily -> DuckDuckGo is explicit. */
import {
    BuiltInToolId,
    FALLBACK_PROVIDER_LABEL,
    PRIMARY_WEB_SEARCH_PROVIDER_LABEL,
    TAVILY_SEARCH_DEPTH,
    ToolErrorKind,
    ToolProviderName,
    WebGatewayToolName,
    WEB_SEARCH_FALLBACK_COUNT_CAP,
    WEB_SEARCH_MAX_RESULTS,
} from "../consts";
import { errorMessage, readString } from "../shared";
import type { JsonObject, ToolArgs, ToolCallOptions } from "../types/tools";
import { OpenClawError, ToolError } from "./errors.ts";
import { invokeGatewayTool } from "./http.ts";

const isNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

const readJsonObject = (value: unknown): JsonObject | undefined => {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
};

/* content can be non-empty with zero hits, so emptiness must prefer details. */
const webSearchPayload = (result: JsonObject): JsonObject => readJsonObject(result.details) ?? result;

/* Provider payload shapes differ; probe top-level arrays plus one nested level. */
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
    args: ToolArgs,
    options?: ToolCallOptions,
): Promise<JsonObject> => {
    const query = readString(args.query) ?? readString(args.subtask);
    if (!query) {
        throw new OpenClawError("web_lookup requires a query.");
    }

    let tavilyFailure: string;
    try {
        const tavily = await invokeGatewayTool(
            WebGatewayToolName.TAVILY_SEARCH,
            { query, search_depth: TAVILY_SEARCH_DEPTH, include_answer: true, max_results: WEB_SEARCH_MAX_RESULTS },
            options,
        );
        if (!webSearchResultIsEmpty(tavily)) {
            return { ...tavily, searchProvider: PRIMARY_WEB_SEARCH_PROVIDER_LABEL };
        }
        tavilyFailure = `${PRIMARY_WEB_SEARCH_PROVIDER_LABEL} returned no results`;
    } catch (error) {
        tavilyFailure = errorMessage(error);
    }

    try {
        const fallback = await invokeGatewayTool(
            WebGatewayToolName.WEB_SEARCH,
            { query, count: Math.min(WEB_SEARCH_MAX_RESULTS, WEB_SEARCH_FALLBACK_COUNT_CAP) },
            options,
        );
        const fallbackPayload = webSearchPayload(fallback);
        const fallbackProvider = readString(fallback.provider)
            ?? readString(fallbackPayload.provider)
            ?? FALLBACK_PROVIDER_LABEL;
        return { ...fallback, searchProvider: fallbackProvider, tavilyFallbackReason: tavilyFailure };
    } catch (fallbackError) {
        /* Both backends down is an environment problem: route to HITL via a structured kind, not text matching. */
        throw new ToolError(
            ToolErrorKind.PROVIDER_UNAVAILABLE,
            `web_lookup failed: tavily(${tavilyFailure}); ${FALLBACK_PROVIDER_LABEL}(${errorMessage(fallbackError)}).`,
            { cause: fallbackError, provider: ToolProviderName.WEB, toolId: BuiltInToolId.WEB_LOOKUP },
        );
    }
};
