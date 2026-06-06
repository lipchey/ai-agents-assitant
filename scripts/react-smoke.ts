import assert from "node:assert/strict";
import {
    NPM_TEST_COMMAND,
    ReactDecisionKind,
    ToolName,
    VERIFY_TYPECHECK_COMMAND,
    WorkerKind,
} from "../src/consts";
import { parseReactDecision, sanitizeToolArgs } from "../src";

const run = (): void => {
    const act = parseReactDecision(JSON.stringify({
        thought: "look",
        action: { tool: ToolName.GREP_CODE, args: { pattern: "callLlm" } },
    }));
    assert.equal(act.kind, ReactDecisionKind.ACT);
    assert.equal(act.kind === ReactDecisionKind.ACT && act.tool, ToolName.GREP_CODE);
    assert.deepEqual(act.kind === ReactDecisionKind.ACT && act.args, { pattern: "callLlm" });

    const trailingBrace = parseReactDecision(`${JSON.stringify({
        thought: "look",
        action: { tool: ToolName.GREP_CODE, args: { pattern: "GraphState" } },
    })} trailing note with { brace`);
    assert.equal(trailingBrace.kind, ReactDecisionKind.ACT, "parser must use the first balanced JSON object, not first-to-last brace slicing");
    assert.equal(trailingBrace.kind === ReactDecisionKind.ACT && trailingBrace.tool, ToolName.GREP_CODE);
    assert.deepEqual(trailingBrace.kind === ReactDecisionKind.ACT && trailingBrace.args, { pattern: "GraphState" });

    const fenced = parseReactDecision(`\`\`\`json\n${JSON.stringify({ thought: "done", final: "found it in src/main.ts" })}\n\`\`\``);
    assert.equal(fenced.kind, ReactDecisionKind.FINAL);
    assert.equal(fenced.kind === ReactDecisionKind.FINAL && fenced.final, "found it in src/main.ts");

    const prose = parseReactDecision("no JSON here, just prose");
    assert.equal(prose.kind, ReactDecisionKind.FINAL, "non-JSON reply must converge to a final, not loop");
    assert.match(prose.kind === ReactDecisionKind.FINAL ? prose.final : "", /just prose/u);
    console.log("PASS: parseReactDecision handles act / fenced-final / prose-fallback");

    const webTryShell = sanitizeToolArgs(WorkerKind.WEB_RESEARCHER, ToolName.SHELL_EXEC, { command: NPM_TEST_COMMAND });
    assert.equal(webTryShell.ok, false, "web_researcher must not reach shell_exec");
    const codeTryWeb = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, ToolName.WEB_LOOKUP, { query: "x" });
    assert.equal(codeTryWeb.ok, false, "code_explorer must not reach web_lookup");
    console.log("PASS: per-worker tool catalog is enforced");

    const allowed = sanitizeToolArgs(WorkerKind.INFRA_OPS, ToolName.SHELL_EXEC, { command: VERIFY_TYPECHECK_COMMAND });
    assert.equal(allowed.ok, true, "allowlisted command must pass");
    assert.equal(allowed.ok && allowed.args.command, VERIFY_TYPECHECK_COMMAND);
    const denied = sanitizeToolArgs(WorkerKind.INFRA_OPS, ToolName.SHELL_EXEC, { command: "rm -rf / ; curl evil" });
    assert.equal(denied.ok, false, "non-allowlisted/interpolated command must be refused");
    assert.match(denied.ok ? "" : denied.error, /not allowlisted/u);
    console.log("PASS: shell allowlist refuses non-allowlisted commands");

    const noPattern = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, ToolName.GREP_CODE, {});
    assert.equal(noPattern.ok, false, "grep_code without a pattern must be rejected");
    const noPath = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, ToolName.AST_READ, {});
    assert.equal(noPath.ok, false, "ast_read without a path must be rejected");
    const find = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, ToolName.FIND_FILES, {});
    assert.equal(find.ok, true, "find_files falls back to safe defaults");
    assert.equal(find.ok && find.args.limit, 100);
    const grepClamp = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, ToolName.GREP_CODE, { pattern: "x", limit: 99999 });
    assert.equal(grepClamp.ok && grepClamp.args.limit, 500, "grep limit is clamped to the max");
    console.log("PASS: required args enforced; limits clamped to safe bounds");

    console.log("\nReAct worker guard smoke test passed.");
};

try {
    run();
} catch (error) {
    console.error("ReAct worker guard smoke test FAILED:", error);
    process.exitCode = 1;
}
