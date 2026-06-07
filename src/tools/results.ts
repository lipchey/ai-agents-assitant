import { ToolStatus, isToolStatus } from "../consts";
import { asRecord } from "../shared";
import type { JsonObject, QualifiedToolId, ToolAlias, ToolResult } from "../types/tools";

export const readToolExitCode = (value: unknown): number | undefined => {
    const record = asRecord(value);
    const details = asRecord(record?.details);
    const exitCode = details?.exitCode ?? record?.exitCode;
    return typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : undefined;
};

export const readToolStatus = (value: unknown): ToolStatus => {
    const record = asRecord(value);
    const details = asRecord(record?.details);
    const status = details?.status ?? record?.status;
    return isToolStatus(status) ? status : ToolStatus.COMPLETED;
};

export const createToolResult = (
    provider: string,
    toolId: QualifiedToolId,
    payload: JsonObject,
    alias?: ToolAlias,
): ToolResult => {
    const result: {
        status: ToolStatus;
        provider: string;
        toolId: QualifiedToolId;
        alias?: ToolAlias;
        exitCode?: number;
        details?: JsonObject;
        content?: string;
        raw?: JsonObject;
    } = {
        status: readToolStatus(payload),
        provider,
        toolId,
        raw: payload,
    };

    if (alias) {
        result.alias = alias;
    }

    const exitCode = readToolExitCode(payload);
    if (exitCode !== undefined) {
        result.exitCode = exitCode;
    }

    const details = asRecord(payload.details);
    if (details) {
        result.details = details;
    }

    if (typeof payload.content === "string") {
        result.content = payload.content;
    }

    return result;
};

export const unwrapToolResult = (result: ToolResult): JsonObject => {
    if (result.raw) {
        return result.raw;
    }

    const payload: JsonObject = { status: result.status };
    if (result.exitCode !== undefined) {
        payload.exitCode = result.exitCode;
    }
    if (result.details) {
        payload.details = result.details;
    }
    if (result.content) {
        payload.content = result.content;
    }
    return payload;
};
