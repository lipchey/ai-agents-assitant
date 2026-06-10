import { DEFAULT_TIMEOUT_S, OpenClawControl } from "../consts";
import { stringifyError } from "../shared";
import type { JsonObject, ToolCallOptions } from "../types/tools";
import { OpenClawError } from "./errors.ts";
import { authHeaders, getGatewayBaseUrl, sleep } from "./gateway.ts";

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

/* Gateway tool retries are bounded; non-object results are wrapped for callers. */
export const invokeGatewayTool = async (
    tool: string,
    args: JsonObject,
    options?: ToolCallOptions,
): Promise<JsonObject> => {
    const maxRetries = options?.maxRetries ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const response = await jsonPost<{
                ok: boolean;
                result?: unknown;
                error?: { message?: string; type?: string };
            }>(
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
