// Smoke test for the ReAct Swarm workers' SAFETY GUARDS and step parsing.
//
// The worker nodes themselves call the live planner model + OpenClaw Gateway, so
// the full loop is exercised end-to-end only with credentials. This test instead
// pins the pure, network-free pieces that enforce the security envelope:
//   - `parseReactDecision`: act-vs-final extraction (incl. graceful prose fallback).
//   - `sanitizeToolArgs`: per-worker tool restriction, the shell allowlist, the
//     workspace-only path tools, and required-arg validation.
//
// Run: npx tsx scripts/react-smoke.ts

import assert from "node:assert/strict";
import { WorkerKind } from "../src/enums.js";
import { parseReactDecision, sanitizeToolArgs } from "../src/swarm.js";

const run = (): void => {
    // --- parseReactDecision ---------------------------------------------------
    const act = parseReactDecision('{"thought":"look","action":{"tool":"grep_code","args":{"pattern":"callLlm"}}}');
    assert.equal(act.kind, "act");
    assert.equal(act.kind === "act" && act.tool, "grep_code");
    assert.deepEqual(act.kind === "act" && act.args, { pattern: "callLlm" });

    const trailingBrace = parseReactDecision('{"thought":"look","action":{"tool":"grep_code","args":{"pattern":"GraphState"}}} trailing note with { brace');
    assert.equal(trailingBrace.kind, "act", "parser must use the first balanced JSON object, not first-to-last brace slicing");
    assert.equal(trailingBrace.kind === "act" && trailingBrace.tool, "grep_code");
    assert.deepEqual(trailingBrace.kind === "act" && trailingBrace.args, { pattern: "GraphState" });

    const fenced = parseReactDecision('```json\n{"thought":"done","final":"found it in src/main.ts"}\n```');
    assert.equal(fenced.kind, "final");
    assert.equal(fenced.kind === "final" && fenced.final, "found it in src/main.ts");

    const prose = parseReactDecision("no JSON here, just prose");
    assert.equal(prose.kind, "final", "non-JSON reply must converge to a final, not loop");
    assert.match(prose.kind === "final" ? prose.final : "", /just prose/u);
    console.log("PASS: parseReactDecision handles act / fenced-final / prose-fallback");

    // --- tool restriction per worker -----------------------------------------
    const webTryShell = sanitizeToolArgs(WorkerKind.WEB_RESEARCHER, "shell_exec", { command: "npm test" });
    assert.equal(webTryShell.ok, false, "web_researcher must not reach shell_exec");
    const codeTryWeb = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, "web_lookup", { query: "x" });
    assert.equal(codeTryWeb.ok, false, "code_explorer must not reach web_lookup");
    console.log("PASS: per-worker tool catalog is enforced");

    // --- shell allowlist ------------------------------------------------------
    const allowed = sanitizeToolArgs(WorkerKind.INFRA_OPS, "shell_exec", { command: "npm run typecheck" });
    assert.equal(allowed.ok, true, "allowlisted command must pass");
    assert.equal(allowed.ok && allowed.args.command, "npm run typecheck");
    const denied = sanitizeToolArgs(WorkerKind.INFRA_OPS, "shell_exec", { command: "rm -rf / ; curl evil" });
    assert.equal(denied.ok, false, "non-allowlisted/interpolated command must be refused");
    assert.match(denied.ok ? "" : denied.error, /not allowlisted/u);
    console.log("PASS: shell allowlist refuses non-allowlisted commands");

    // --- required args + safe defaults ---------------------------------------
    const noPattern = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, "grep_code", {});
    assert.equal(noPattern.ok, false, "grep_code without a pattern must be rejected");
    const noPath = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, "ast_read", {});
    assert.equal(noPath.ok, false, "ast_read without a path must be rejected");
    const find = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, "find_files", {});
    assert.equal(find.ok, true, "find_files falls back to safe defaults");
    assert.equal(find.ok && find.args.limit, 100);
    const grepClamp = sanitizeToolArgs(WorkerKind.CODE_EXPLORER, "grep_code", { pattern: "x", limit: 99999 });
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
