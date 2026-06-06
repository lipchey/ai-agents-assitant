// HTTP transport to the OpenClaw Gateway: the raw JSON POST and the retrying
// `/tools/invoke` wrapper used by every gateway-side tool call.
import { OpenClawControl } from "../constants.js";
import { stringifyError } from "../shared/text.js";
import { OpenClawError } from "./errors.js";
import { DEFAULT_TIMEOUT_S, authHeaders, getGatewayBaseUrl, sleep } from "./gateway.js";
import type { JsonObject, OpenClawRpcOptions } from "./types.js";

export const jsonPost = async <T>(
    endpoint: string,
    body: JsonObject,
    options?: { timeoutS?: number; headers?: Record<string, string> },
): Promise<T> => {
    const response = await fetch(`${getGatewayBaseUrl()}${endpoint}`, {
        method: "POST",
        headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((options?.timeoutS ?? DEFAULT_TIMEOUT_S) * 1_000),
    });

    const responseText = await response.text();
    let payload: unknown = null;
    if (responseText) {
        try {
            payload = JSON.parse(responseText);
        } catch {
            payload = { message: responseText };
        }
    }

    if (!response.ok) {
        throw new OpenClawError(`OpenClaw HTTP ${response.status} ${response.statusText}: ${stringifyError(payload)}`);
    }

    return payload as T;
};

// Invoke a Gateway-side tool via /tools/invoke with bounded exponential-backoff
// retries. Non-object results are wrapped as { value } so callers always get a
// JsonObject back.
export const invokeGatewayTool = async (
    tool: string,
    args: JsonObject,
    options?: OpenClawRpcOptions,
): Promise<JsonObject> => {
    const maxRetries = options?.maxRetries ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const response = await jsonPost<{ ok: boolean; result?: unknown; error?: { message?: string; type?: string } }>(
                OpenClawControl.TOOLS_INVOKE_ENDPOINT,
                {
                    tool,
                    args,
                    sessionKey: options?.sessionKey ?? OpenClawControl.DEFAULT_SESSION_KEY,
                    ...(options?.action ? { action: options.action } : {}),
                    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
                },
                { timeoutS: options?.timeoutS ?? DEFAULT_TIMEOUT_S },
            );

            if (!response.ok) {
                throw new OpenClawError(response.error?.message ?? `OpenClaw rejected tool ${tool}.`);
            }

            if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
                return { value: response.result };
            }

            return response.result as JsonObject;
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries) {
                break;
            }
            await sleep(250 * 2 ** attempt);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new OpenClawError(`Failed to invoke OpenClaw tool ${tool}: ${message}`, { cause: lastError });
};
