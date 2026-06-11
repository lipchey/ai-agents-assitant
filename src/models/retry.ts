/* Provider-layer retries (spec D5): exponential backoff with full jitter on
   transient transport failures only — HTTP 429/5xx, timeouts, network errors.
   4xx validation errors and unknown failures propagate immediately so a broken
   request fails fast instead of burning the retry budget. */
import { DEFAULT_LLM_MAX_RETRIES, LLM_RETRY_BASE_DELAY_MS } from "../consts";

export type RetryAttempt = {
    /* 1-based ordinal of the retry being scheduled. */
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: unknown;
};

export type RetryOptions = {
    maxRetries?: number | undefined;
    onRetry?: ((info: RetryAttempt) => void) | undefined;
    /* Injectable for deterministic unit tests; defaults are real timers/jitter. */
    sleep?: ((ms: number) => Promise<void>) | undefined;
    random?: (() => number) | undefined;
};

const TRANSIENT_ERROR_NAMES = new Set([
    "AbortError",
    "TimeoutError",
    "APIConnectionError",
    "APIConnectionTimeoutError",
]);

const TRANSIENT_NETWORK_CODES = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
]);

/* Cause chains from fetch/undici and the provider SDKs are shallow; the bound
   only guards against pathological self-referencing causes. */
const MAX_CAUSE_DEPTH = 5;

export const isTransientLlmError = (error: unknown): boolean => {
    let current: unknown = error;
    for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {
        const { status, name, code, cause } = current as {
            status?: unknown;
            name?: unknown;
            code?: unknown;
            cause?: unknown;
        };
        if (typeof status === "number") {
            /* An HTTP status is authoritative: retry request timeouts (408), rate
               limits (429), and server-side failures (5xx), never other
               client-side validation errors. */
            return status === 408 || status === 429 || status >= 500;
        }
        if (typeof name === "string" && TRANSIENT_ERROR_NAMES.has(name)) {
            return true;
        }
        if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) {
            return true;
        }
        current = cause;
    }
    return false;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const withLlmRetries = async <T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> => {
    const maxRetries = options.maxRetries ?? DEFAULT_LLM_MAX_RETRIES;
    const sleep = options.sleep ?? defaultSleep;
    const random = options.random ?? Math.random;
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxRetries || !isTransientLlmError(error)) {
                throw error;
            }
            /* Full jitter: uniform in [0, base * 2^attempt) — decorrelates herds
               better than equal-jitter for the same expected backoff. */
            const delayMs = Math.round(random() * LLM_RETRY_BASE_DELAY_MS * 2 ** attempt);
            options.onRetry?.({ attempt: attempt + 1, maxRetries, delayMs, error });
            await sleep(delayMs);
        }
    }
};
