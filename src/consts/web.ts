/* Fallback label mirrors tools.web.search.provider in openclaw.config.json5. */
export const FALLBACK_PROVIDER_LABEL = "duckduckgo";

export const PRIMARY_WEB_SEARCH_PROVIDER_LABEL = "tavily";

export const WEB_SEARCH_MAX_RESULTS = 8;

/* Tavily rich search is slower, but gives the answer field used before fallback. */
export const TAVILY_SEARCH_DEPTH = "advanced";

/* DuckDuckGo's OpenClaw wrapper accepts count rather than max_results. */
export const WEB_SEARCH_FALLBACK_COUNT_CAP = 10;
