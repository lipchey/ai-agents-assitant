/* Consensus is not correctness; code paths still need an objective typecheck. */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
    GraphComplexity,
    ToolName,
    ToolStatus,
    VERIFY_REPORT_OUTPUT_MAX_CHARS,
    VERIFY_REPORT_OUTPUT_TAIL_LINES,
    VERIFY_RPC_TIMEOUT_S,
    VERIFY_TIMEOUT_S,
    VERIFY_TYPECHECK_COMMAND,
} from "../../consts";
import { asRecord, errorMessage } from "../../shared";
import { readToolRegistry } from "../../tools";
import type { GraphStateValue } from "../../types/graph";
import type { JsonObject, ToolResult } from "../../types/tools";

type CompactText = {
    readonly text: string;
    readonly truncatedChars?: number;
};

type StreamReport = {
    readonly text: string;
    readonly lineCount: number;
    readonly tailLines?: number;
    readonly omittedLines?: number;
    readonly truncatedChars?: number;
};

const copyDefined = (target: JsonObject, key: string, value: unknown): void => {
    if (value !== undefined) {
        target[key] = value;
    }
};

const compactTail = (value: string): CompactText => {
    if (value.length <= VERIFY_REPORT_OUTPUT_MAX_CHARS) {
        return { text: value };
    }

    const truncatedChars = value.length - VERIFY_REPORT_OUTPUT_MAX_CHARS;
    return {
        text: `[truncated ${truncatedChars} chars before tail]\n${value.slice(-VERIFY_REPORT_OUTPUT_MAX_CHARS)}`,
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
    const tailLines = lines.slice(-VERIFY_REPORT_OUTPUT_TAIL_LINES);
    const omittedLines = lines.length - tailLines.length;
    const compact = compactTail(tailLines.join("\n"));

    return {
        text: compact.text,
        lineCount: lines.length,
        ...(omittedLines > 0 ? { tailLines: tailLines.length, omittedLines } : {}),
        ...(compact.truncatedChars !== undefined ? { truncatedChars: compact.truncatedChars } : {}),
    };
};

const compactVerificationDetails = (report: ToolResult): JsonObject => {
    const details = asRecord(report.details);
    const compact: JsonObject = {};
    if (!details) {
        return compact;
    }

    copyDefined(compact, "label", details.label);
    copyDefined(compact, "command", details.command);
    copyDefined(compact, "args", details.args);
    copyDefined(compact, "cwd", details.cwd);
    copyDefined(compact, "exitCode", details.exitCode ?? report.exitCode);
    copyDefined(compact, "signal", details.signal);
    copyDefined(compact, "error", details.error);
    copyDefined(compact, "stdout", summarizeProcessStream(details.stdout));
    copyDefined(compact, "stderr", summarizeProcessStream(details.stderr));

    return compact;
};

const buildVerificationReport = (report: ToolResult): string => {
    const details = compactVerificationDetails(report);
    const projected: JsonObject = {
        status: report.status,
        provider: report.provider,
        toolId: report.toolId,
    };

    copyDefined(projected, "alias", report.alias);
    copyDefined(projected, "exitCode", report.exitCode);
    if (Object.keys(details).length > 0) {
        projected.details = details;
    }
    copyDefined(projected, "content", summarizeProcessStream(report.content));

    return JSON.stringify(projected, null, 2);
};

export const verify = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const verifyAttempts = (state.verifyAttempts ?? 0) + 1;

    if (state.complexity === GraphComplexity.PURE_REASONING) {
        return {
            verificationPassed: true,
            verificationReport: "Skipped objective typecheck: pure_reasoning output has no code to compile.",
            bestDraft: state.currentDraft || state.bestDraft || "",
            verifyAttempts,
        };
    }

    try {
        const report = await readToolRegistry(config).invoke(
            ToolName.RUN_TESTS,
            { command: VERIFY_TYPECHECK_COMMAND, timeout: VERIFY_TIMEOUT_S },
            { timeoutS: VERIFY_RPC_TIMEOUT_S, idempotencyKey: `verify-${state.debateIterations}`, maxRetries: 0 },
        );
        const passed = report.status === ToolStatus.COMPLETED && (report.exitCode === undefined || report.exitCode === 0);

        return {
            verificationPassed: passed,
            verificationReport: buildVerificationReport(report),
            bestDraft: passed ? state.currentDraft : state.bestDraft || "",
            verifyAttempts,
        };
    } catch (error) {
        return {
            verificationPassed: false,
            verificationReport: `Verification failed before tests completed: ${errorMessage(error)}`,
            verifyAttempts,
        };
    }
};
