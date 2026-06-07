import assert from "node:assert/strict";
import {
    BuiltInToolId,
    FailureType,
    NPM_TEST_COMMAND,
    ReactDecisionKind,
    ToolCapability,
    ToolErrorKind,
    ToolName,
    ToolProviderName,
    ToolStatus,
    VERIFY_TYPECHECK_COMMAND,
    WorkerKind,
} from "../src/consts";
import {
    classifyFailure,
    createDefaultToolRegistry,
    createToolRegistry,
    parseReactDecision,
    sanitizeToolArgs,
    ToolError,
    type ToolArgs,
    type ToolProvider,
} from "../src";
import { DEFAULT_TOOL_BINDINGS } from "../src/tools/bindings.ts";
import { createLocalProvider } from "../src/tools/providers";
import type { QualifiedToolId } from "../src";

const run = async (): Promise<void> => {
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

    const registry = createDefaultToolRegistry();
    assert.deepEqual(
        registry.allowedAliases(WorkerKind.CODE_EXPLORER),
        [ToolName.FIND_FILES, ToolName.GREP_CODE, ToolName.AST_READ],
        "default registry must expose the code explorer aliases through policy",
    );
    assert.match(registry.renderCatalog(WorkerKind.INFRA_OPS), /shell_exec/u, "rendered catalog must include policy-allowed tools");
    const rejects = async (
        alias: ToolName,
        args: ToolArgs,
        kind: ToolErrorKind,
        provider: ToolProviderName,
        toolId: BuiltInToolId,
    ): Promise<void> => {
        await assert.rejects(
            () => registry.invoke(alias, args),
            (error: unknown) =>
                error instanceof ToolError
                && error.kind === kind
                && error.provider === provider
                && error.toolId === toolId,
            `${alias} must reject with ${kind}`,
        );
    };
    await rejects(ToolName.GREP_CODE, {}, ToolErrorKind.VALIDATION, ToolProviderName.LOCAL, BuiltInToolId.LOCAL_GREP_CODE);
    await rejects(ToolName.AST_READ, {}, ToolErrorKind.VALIDATION, ToolProviderName.LOCAL, BuiltInToolId.LOCAL_AST_READ);
    await rejects(
        ToolName.SHELL_EXEC,
        { command: "rm -rf /" },
        ToolErrorKind.POLICY,
        ToolProviderName.LOCAL,
        BuiltInToolId.LOCAL_SHELL_EXEC,
    );
    await rejects(
        ToolName.FIND_FILES,
        { path: "../../etc" },
        ToolErrorKind.EXECUTION,
        ToolProviderName.LOCAL,
        BuiltInToolId.LOCAL_FIND_FILES,
    );
    await rejects(ToolName.WEB_LOOKUP, {}, ToolErrorKind.VALIDATION, ToolProviderName.WEB, BuiltInToolId.WEB_LOOKUP);
    assert.equal(classifyFailure(new ToolError(ToolErrorKind.VALIDATION, "x")), FailureType.REASONING);
    assert.equal(classifyFailure(new ToolError(ToolErrorKind.PROVIDER_UNAVAILABLE, "x")), FailureType.ENVIRONMENT);
    console.log("PASS: structured ToolError kinds route without provider substring matching");

    const webProvider = (name: string, id: QualifiedToolId, description: string): ToolProvider => ({
        name,
        catalog: [{
            id,
            aliases: [ToolName.WEB_LOOKUP],
            capabilities: [ToolCapability.EXTERNAL_NETWORK],
            description,
            validate: () => ({ ok: true, alias: ToolName.WEB_LOOKUP, args: { query: name } }),
            invoke: async () => ({
                status: ToolStatus.COMPLETED,
                provider: name,
                toolId: id,
                alias: ToolName.WEB_LOOKUP,
                raw: { provider: name },
            }),
        }],
    });
    const replacementId: QualifiedToolId = "mock:web_lookup";
    const reboundRegistry = createToolRegistry({
        providers: [
            createLocalProvider(),
            webProvider("replacement-web", replacementId, '{"query":"replacement"}: rebound search backend.'),
            webProvider("stray-web", "stray:web_lookup", '{"query":"stray"}: unbound search backend.'),
        ],
        bindings: { ...DEFAULT_TOOL_BINDINGS, [ToolName.WEB_LOOKUP]: replacementId },
    });
    const reboundCatalog = reboundRegistry.renderCatalog(WorkerKind.WEB_RESEARCHER);
    assert.match(reboundCatalog, /rebound search backend/u, "catalog must describe the actively bound provider");
    assert.doesNotMatch(reboundCatalog, /unbound search backend/u, "catalog must not describe unbound providers sharing the alias");

    const duplicateProvider = (name: string): ToolProvider => ({
        name,
        catalog: [{
            id: BuiltInToolId.LOCAL_FIND_FILES,
            aliases: [ToolName.FIND_FILES],
            capabilities: [ToolCapability.READ_WORKSPACE],
            suggestedKinds: [WorkerKind.CODE_EXPLORER],
            description: '{"path":"."}: fake duplicate descriptor.',
            validate: () => ({ ok: true, alias: ToolName.FIND_FILES, args: { path: "." } }),
            invoke: async () => ({
                status: ToolStatus.COMPLETED,
                provider: ToolProviderName.LOCAL,
                toolId: BuiltInToolId.LOCAL_FIND_FILES,
                alias: ToolName.FIND_FILES,
                raw: {},
            }),
        }],
    });
    assert.throws(
        () => createToolRegistry({ providers: [duplicateProvider("duplicate-a"), duplicateProvider("duplicate-b")] }),
        (error: unknown) => error instanceof ToolError && error.kind === ToolErrorKind.VALIDATION,
        "registry must reject duplicate qualified ids at startup",
    );
    console.log("PASS: default registry policy renders aliases; duplicate provider ids fail fast");

    console.log("\nReAct worker guard smoke test passed.");
};

try {
    await run();
} catch (error) {
    console.error("ReAct worker guard smoke test FAILED:", error);
    process.exitCode = 1;
}
