import type { ToolErrorKind } from "../consts";
import type { QualifiedToolId } from "../types/tools";

export type OpenClawErrorOptions = ErrorOptions & {
    /* HTTP status of the failed gateway response; the retry layer classifies
       transient failures (429/5xx) by this field. */
    readonly status?: number;
};

export class OpenClawError extends Error {
    readonly status?: number;

    constructor(message: string, options?: OpenClawErrorOptions) {
        super(message, options);
        this.name = "OpenClawError";
        if (options?.status !== undefined) {
            this.status = options.status;
        }
    }
}

export type ToolErrorOptions = ErrorOptions & {
    readonly provider?: string;
    readonly toolId?: QualifiedToolId;
};

export class ToolError extends Error {
    readonly kind: ToolErrorKind;
    readonly provider?: string;
    readonly toolId?: QualifiedToolId;

    constructor(kind: ToolErrorKind, message: string, options?: ToolErrorOptions) {
        super(message, options);
        this.name = "ToolError";
        this.kind = kind;
        if (options?.provider) {
            this.provider = options.provider;
        }
        if (options?.toolId) {
            this.toolId = options.toolId;
        }
    }
}
