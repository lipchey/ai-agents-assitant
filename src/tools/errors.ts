import type { ToolErrorKind } from "../consts";
import type { QualifiedToolId } from "../types/tools";

export class OpenClawError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "OpenClawError";
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
