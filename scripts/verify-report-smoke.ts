import assert from "node:assert/strict";
import {
    ToolName,
    ToolStatus,
    VERIFY_REPORT_OUTPUT_HEAD_LINES,
    VERIFY_REPORT_OUTPUT_MAX_CHARS,
    VERIFY_REPORT_OUTPUT_TAIL_LINES,
} from "../src/consts";
import { buildCompactToolResultReport } from "../src/tools";
import type { ToolResult } from "../src/types";

const asRecord = (value: unknown): Record<string, unknown> => {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
};

const run = (): void => {
    const lineCount = VERIFY_REPORT_OUTPUT_HEAD_LINES + VERIFY_REPORT_OUTPUT_TAIL_LINES + 5;
    const stderr = Array.from({ length: lineCount }, (_, index) => `diagnostic-${index + 1}`).join("\n");
    const longDetail = `start-${"x".repeat(VERIFY_REPORT_OUTPUT_MAX_CHARS)}-end`;
    const report: ToolResult = {
        status: ToolStatus.FAILED,
        provider: "local",
        toolId: "local:run_tests",
        alias: ToolName.RUN_TESTS,
        details: {
            command: "npm",
            args: ["run", "typecheck"],
            exitCode: 2,
            signal: null,
            stderr,
            failures: [{ message: "custom provider field" }],
            longDetail,
        },
        raw: {
            duplicatedPayload: "must not be serialized",
        },
    };

    const compact = JSON.parse(buildCompactToolResultReport(report));
    const details = asRecord(asRecord(compact).details);
    const stderrReport = asRecord(details.stderr);
    const stderrText = String(stderrReport.text);
    const longDetailReport = asRecord(details.longDetail);
    const longDetailText = String(longDetailReport.text);

    assert.equal(asRecord(compact).exitCode, 2, "details.exitCode must be lifted to the top-level report");
    assert.equal(details.exitCode, undefined, "exitCode must not be duplicated inside details");
    assert.equal(details.signal, undefined, "normal signal:null noise must be omitted");
    assert.equal(asRecord(compact).raw, undefined, "raw payload must not be serialized");
    assert.match(stderrText, /diagnostic-1/u, "head diagnostics must be retained");
    assert.match(
        stderrText,
        new RegExp(`diagnostic-${VERIFY_REPORT_OUTPUT_HEAD_LINES}`, "u"),
        "head cap must be retained",
    );
    assert.doesNotMatch(
        stderrText,
        new RegExp(`diagnostic-${VERIFY_REPORT_OUTPUT_HEAD_LINES + 1}`, "u"),
        "middle diagnostics must be omitted",
    );
    assert.match(stderrText, new RegExp(`diagnostic-${lineCount}`, "u"), "tail diagnostics must be retained");
    assert.equal(stderrReport.headLines, VERIFY_REPORT_OUTPUT_HEAD_LINES);
    assert.equal(stderrReport.tailLines, VERIFY_REPORT_OUTPUT_TAIL_LINES);
    assert.equal(stderrReport.omittedLines, 5);
    assert.deepEqual(
        details.failures,
        [{ message: "custom provider field" }],
        "unknown provider fields must survive when bounded",
    );
    assert.match(longDetailText, /^start-/u, "long unknown strings must retain their start");
    assert.match(longDetailText, /-end$/u, "long unknown strings must retain their end");
    assert.ok(longDetailText.length <= VERIFY_REPORT_OUTPUT_MAX_CHARS, "long unknown strings must stay bounded");

    console.log("Verify report smoke test passed.");
};

try {
    run();
} catch (error) {
    console.error("Verify report smoke test FAILED:", error);
    process.exitCode = 1;
}
