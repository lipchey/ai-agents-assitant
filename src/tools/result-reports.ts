import {
    VERIFY_REPORT_OUTPUT_HEAD_LINES,
    VERIFY_REPORT_OUTPUT_MAX_CHARS,
    VERIFY_REPORT_OUTPUT_TAIL_LINES,
} from "../consts";
import { asRecord } from "../shared";
import type { JsonObject, ToolResult } from "../types/tools";
import { readToolExitCode } from "./results.ts";

type CompactText = {
    readonly text: string;
    readonly truncatedChars?: number;
};

type StreamReport = {
    readonly text: string;
    readonly lineCount: number;
    readonly headLines?: number;
    readonly tailLines?: number;
    readonly omittedLines?: number;
    readonly truncatedChars?: number;
};

const copyDefined = (target: JsonObject, key: string, value: unknown): void => {
    if (value !== undefined) {
        target[key] = value;
    }
};

const compactMiddle = (value: string): CompactText => {
    if (value.length <= VERIFY_REPORT_OUTPUT_MAX_CHARS) {
        return { text: value };
    }

    let truncatedChars = value.length - VERIFY_REPORT_OUTPUT_MAX_CHARS;
    let marker = `\n[truncated ${truncatedChars} chars from middle]\n`;
    let keptChars = Math.max(0, VERIFY_REPORT_OUTPUT_MAX_CHARS - marker.length);
    let headChars = Math.ceil(keptChars / 2);
    let tailChars = Math.floor(keptChars / 2);
    truncatedChars = value.length - headChars - tailChars;
    marker = `\n[truncated ${truncatedChars} chars from middle]\n`;
    keptChars = Math.max(0, VERIFY_REPORT_OUTPUT_MAX_CHARS - marker.length);
    headChars = Math.ceil(keptChars / 2);
    tailChars = Math.floor(keptChars / 2);
    truncatedChars = value.length - headChars - tailChars;

    return {
        text: `${value.slice(0, headChars)}${marker}${tailChars > 0 ? value.slice(-tailChars) : ""}`,
        truncatedChars,
    };
};

const summarizeProcessStream = (value: unknown): StreamReport | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trimEnd();
    if (!trimmed) {
        return undefined;
    }

    const lines = trimmed.split(/\r?\n/u);
    const maxLines = VERIFY_REPORT_OUTPUT_HEAD_LINES + VERIFY_REPORT_OUTPUT_TAIL_LINES;
    const omittedLines = Math.max(0, lines.length - maxLines);
    const selectedLines =
        omittedLines > 0
            ? [
                  ...lines.slice(0, VERIFY_REPORT_OUTPUT_HEAD_LINES),
                  `[omitted ${omittedLines} lines]`,
                  ...lines.slice(-VERIFY_REPORT_OUTPUT_TAIL_LINES),
              ]
            : lines;
    const compact = compactMiddle(selectedLines.join("\n"));

    return {
        text: compact.text,
        lineCount: lines.length,
        ...(omittedLines > 0
            ? {
                  headLines: VERIFY_REPORT_OUTPUT_HEAD_LINES,
                  tailLines: VERIFY_REPORT_OUTPUT_TAIL_LINES,
                  omittedLines,
              }
            : {}),
        ...(compact.truncatedChars !== undefined ? { truncatedChars: compact.truncatedChars } : {}),
    };
};

const stringifyJson = (value: unknown): string | undefined => {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return undefined;
    }
};

const compactUnknownDetailValue = (value: unknown): unknown => {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === "string") {
        return value.length > VERIFY_REPORT_OUTPUT_MAX_CHARS || /\r?\n/u.test(value)
            ? summarizeProcessStream(value)
            : value;
    }
    if (!value || typeof value !== "object") {
        return value;
    }

    const serialized = stringifyJson(value);
    if (!serialized) {
        return String(value);
    }
    if (serialized.length <= VERIFY_REPORT_OUTPUT_MAX_CHARS) {
        return value;
    }

    const compact = compactMiddle(serialized);
    return {
        text: compact.text,
        serialized: true,
        ...(compact.truncatedChars !== undefined ? { truncatedChars: compact.truncatedChars } : {}),
    };
};

const compactToolResultDetails = (report: ToolResult): JsonObject => {
    const details = asRecord(report.details);
    const compact: JsonObject = {};
    if (!details) {
        return compact;
    }

    for (const [key, value] of Object.entries(details)) {
        switch (key) {
            case "exitCode":
                break;
            case "signal":
                copyDefined(compact, key, value === null ? undefined : value);
                break;
            case "stdout":
            case "stderr":
                copyDefined(compact, key, summarizeProcessStream(value));
                break;
            default:
                copyDefined(compact, key, compactUnknownDetailValue(value));
        }
    }

    return compact;
};

export const buildCompactToolResultReport = (report: ToolResult): string => {
    const details = compactToolResultDetails(report);
    const exitCode = report.exitCode ?? readToolExitCode({ details: report.details });
    const projected: JsonObject = {
        status: report.status,
        provider: report.provider,
        toolId: report.toolId,
    };

    copyDefined(projected, "alias", report.alias);
    copyDefined(projected, "exitCode", exitCode);
    if (Object.keys(details).length > 0) {
        projected.details = details;
    }
    copyDefined(projected, "content", summarizeProcessStream(report.content));

    return JSON.stringify(projected, null, 2);
};
