export type JsonObject = Record<string, unknown>;

export type OpenClawRpcArgs = JsonObject & {
    command?: string;
    path?: string;
    pattern?: string;
    query?: string;
    subtask?: string;
    workdir?: string;
    requireConfirmation?: boolean;
    timeout?: number;
};

export type OpenClawRpcOptions = {
    timeoutS?: number;
    idempotencyKey?: string;
    maxRetries?: number;
    sessionKey?: string;
    action?: string;
};
