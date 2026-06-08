import { LogFormat } from "../consts";
import { safeJson } from "../shared";
import type { LogFields, LogFormatter } from "../types/logging.ts";
import { normalizeLogFields, textFieldValue } from "./fields.ts";

const assertNeverFormat = (format: never): never => {
    throw new Error(`Unhandled log format: ${String(format)}`);
};

const timestamp = (time: Date): string =>
    Number.isFinite(time.getTime()) ? time.toISOString() : new Date(0).toISOString();

const formatFields = (fields?: LogFields): string => {
    const normalized = normalizeLogFields(fields);
    if (!normalized) {
        return "";
    }
    return Object.keys(normalized)
        .sort()
        .map((key) => `${key}=${textFieldValue(key, normalized[key])}`)
        .join(" ");
};

export const textFormatter: LogFormatter = (record) => {
    const fieldText = formatFields(record.fields);
    return `${timestamp(record.time)} ${record.level.toUpperCase()} ${record.message}${fieldText ? ` ${fieldText}` : ""}`;
};

export const jsonFormatter: LogFormatter = (record) => {
    const fields = normalizeLogFields(record.fields);
    const payload = {
        time: timestamp(record.time),
        level: record.level,
        message: record.message,
        ...(fields ? { fields } : {}),
    };
    const encoded = safeJson(payload);
    return encoded.startsWith("{") ? encoded : JSON.stringify({ message: record.message, serializationError: encoded });
};

export const formatterForFormat = (format: LogFormat): LogFormatter => {
    switch (format) {
        case LogFormat.TEXT:
            return textFormatter;
        case LogFormat.JSON:
            return jsonFormatter;
        default:
            return assertNeverFormat(format);
    }
};
