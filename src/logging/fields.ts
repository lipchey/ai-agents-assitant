import {
    LOG_FIELD_MAX_ARRAY_ITEMS,
    LOG_FIELD_MAX_DEPTH,
    LOG_FIELD_STRING_MAX_CHARS,
} from "../consts";
import { errorMessage, stringifyError, truncate } from "../shared";
import type { LogFields } from "../types/logging.ts";

const CIRCULAR_VALUE = "[Circular]";
const MAX_DEPTH_VALUE = "[MaxDepth]";

const normalizeString = (value: string): string => truncate(value, LOG_FIELD_STRING_MAX_CHARS);

const normalizeError = (error: Error): LogFields => ({
    name: normalizeString(error.name),
    message: normalizeString(error.message),
});

const normalizeObject = (value: Record<string, unknown>, seen: WeakSet<object>, depth: number): LogFields => {
    const normalized: LogFields = {};
    for (const key of Object.keys(value).sort()) {
        const normalizedValue = normalizeLogValue(value[key], seen, depth + 1);
        if (normalizedValue !== undefined) {
            normalized[key] = normalizedValue;
        }
    }
    return normalized;
};

export const normalizeLogValue = (value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === "string") {
        return normalizeString(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (typeof value === "symbol") {
        return normalizeString(String(value));
    }
    if (typeof value === "function") {
        return normalizeString(`[Function ${value.name || "anonymous"}]`);
    }
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : "Invalid Date";
    }
    if (value instanceof Error) {
        return normalizeError(value);
    }
    if (seen.has(value)) {
        return CIRCULAR_VALUE;
    }
    if (depth >= LOG_FIELD_MAX_DEPTH) {
        return MAX_DEPTH_VALUE;
    }

    seen.add(value);
    try {
        if (Array.isArray(value)) {
            const normalized = value
                .slice(0, LOG_FIELD_MAX_ARRAY_ITEMS)
                .map((item) => normalizeLogValue(item, seen, depth + 1));
            if (value.length > LOG_FIELD_MAX_ARRAY_ITEMS) {
                normalized.push(`[truncated ${value.length - LOG_FIELD_MAX_ARRAY_ITEMS} items]`);
            }
            return normalized;
        }
        return normalizeObject(value as Record<string, unknown>, seen, depth);
    } finally {
        seen.delete(value);
    }
};

export const normalizeLogFields = (fields?: LogFields): LogFields | undefined => {
    if (!fields) {
        return undefined;
    }
    const normalized = normalizeObject(fields, new WeakSet(), 0);
    return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const readErrorMessage = (value: unknown): string | undefined => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const maybeMessage = (value as Record<string, unknown>).message;
        return typeof maybeMessage === "string" ? maybeMessage : undefined;
    }
    return undefined;
};

export const textFieldValue = (key: string, value: unknown): string => {
    if (key === "error") {
        return JSON.stringify(readErrorMessage(value) ?? stringifyError(value));
    }
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value) ?? JSON.stringify(errorMessage(value));
};
