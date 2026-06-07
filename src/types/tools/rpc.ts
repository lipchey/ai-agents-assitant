export type JsonObject = Record<string, unknown>;

export type ToolArgs = JsonObject & {
    command?: string;
    path?: string;
    pattern?: string;
    query?: string;
    subtask?: string;
    workdir?: string;
    requireConfirmation?: boolean;
    timeout?: number;
};

export type ToolCallOptions = {
    timeoutS?: number;
    idempotencyKey?: string;
    maxRetries?: number;
    sessionKey?: string;
    action?: string;
};

export type ToolCallContext = ToolCallOptions;

export type OpenClawRpcArgs = ToolArgs;
export type OpenClawRpcOptions = ToolCallOptions;
