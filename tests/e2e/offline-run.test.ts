/*
 * Offline full-graph e2e (R8, plan 8.2): four complete runAgentTask runs over the
 * fake transport with a local-only tool registry. No network, no gateway, no
 * credentials. The scripted ChatProvider replays canned decisions keyed by role;
 * the only real I/O is the workspace fixture read (ast_read) and the verify node
 * spawning `npm run typecheck` inside a per-run fixture copy. Each run installs a
 * FRESH fake provider (resets ordinals) and uninstalls it in afterEach.
 *
 * Script ordinals are per role, consumed in call order. A missing or exhausted
 * step throws loudly, so a script that drifts from the real route fails the test
 * rather than silently rerouting — the scripts below double as a route assertion.
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuiltInToolId, MainNode, ModelTransport, RunStatus, ToolName } from "../../src/consts";
import { createFakeChatProvider, parseProfile } from "../../src/models";
import type { Profile } from "../../src/models";
import { runAgentTask } from "../../src/app/run-agent-task.ts";
import { createToolRegistry, setFakeChatProvider } from "../../src/tools";
import type { QualifiedToolId, ToolRegistry } from "../../src/tools";
import { createLocalProvider } from "../../src/tools/providers/index.ts";

const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_DIR = join(E2E_DIR, "fixtures", "calc-workspace");
const WORK_DIR = join(E2E_DIR, ".work");
const FIXTURE_REL = "src/calc.ts";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/* Fake transport + four tiers bound to real model-pricing.json keys so the run
   prices exactly like a live one (totalCostUsd > 0). Generous budget keeps every
   soft-ceiling routing gate open. */
const PROFILE: Profile = parseProfile(
    {
        name: "offline-e2e",
        transport: { default: ModelTransport.FAKE },
        tiers: {
            worker: { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
            skilled: { provider: "anthropic", model: "anthropic/claude-sonnet-4-6" },
            adviser: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
            frontier: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
        },
        budget: { costBudgetUsd: 5.0 },
    },
    "offline-e2e",
);

/* The default bindings minus the web alias: with only the local provider
   registered, requiresGateway() is false so no OpenClaw gateway starts. The map is
   deliberately partial (no web_lookup) — the registry only validates the aliases
   actually bound, all of which the local provider advertises — so it is widened
   through `unknown` to the full Record the option type names. */
const LOCAL_ONLY_BINDINGS = {
    [ToolName.FIND_FILES]: BuiltInToolId.LOCAL_FIND_FILES,
    [ToolName.GREP_CODE]: BuiltInToolId.LOCAL_GREP_CODE,
    [ToolName.AST_READ]: BuiltInToolId.LOCAL_AST_READ,
    [ToolName.SHELL_EXEC]: BuiltInToolId.LOCAL_SHELL_EXEC,
    [ToolName.RUN_TESTS]: BuiltInToolId.LOCAL_RUN_TESTS,
} as unknown as Record<ToolName, QualifiedToolId>;

const localRegistry = (): ToolRegistry =>
    createToolRegistry({ providers: [createLocalProvider()], bindings: LOCAL_ONLY_BINDINGS });

const nodeSequence = (visits: ReadonlyArray<{ node: string }>): string[] => visits.map((visit) => visit.node);

/* Recursive per-run copy of the fixture so each run mutates an isolated work tree. */
const prepareWork = (name: string): { dir: string; file: string } => {
    const dir = join(WORK_DIR, name);
    cpSync(FIXTURE_DIR, dir, { recursive: true });
    return { dir, file: join(dir, FIXTURE_REL) };
};

const CODE_TASK = "Add a subtract helper to the calc module.";

/* Type-correct full-file replacement: verify (real `npm run typecheck`) passes. */
const GOOD_PATCH = [
    `<<<PATCH file="${FIXTURE_REL}">>>`,
    "export const add = (a: number, b: number): number => a + b;",
    "export const sub = (a: number, b: number): number => a - b;",
    "<<<END PATCH>>>",
].join("\n");

/* Returns a string where a number is required: tsc exits non-zero, verify fails. */
const badPatch = (marker: string): string =>
    [
        `<<<PATCH file="${FIXTURE_REL}">>>`,
        `export const add = (a: number, b: number): number => "${marker}";`,
        "<<<END PATCH>>>",
    ].join("\n");

beforeEach(() => {
    rmSync(WORK_DIR, { recursive: true, force: true });
    mkdirSync(WORK_DIR, { recursive: true });
});

afterEach(() => {
    setFakeChatProvider(undefined);
    rmSync(WORK_DIR, { recursive: true, force: true });
});

describe("offline full-graph e2e", () => {
    it("(a) trivial route: router -> directResponder -> finalize", async () => {
        setFakeChatProvider(
            createFakeChatProvider({
                router: ['{"complexity":"trivial","routeConfidence":0.95}', "Paris is the capital of France."],
            }),
        );

        const summary = await runAgentTask("What is the capital of France?", {
            profile: PROFILE,
            budgetUsd: 5,
            tools: localRegistry(),
        });

        expect(summary.status).toBe(RunStatus.COMPLETED);
        expect(summary.answer).toBe("Paris is the capital of France.");
        expect(nodeSequence(summary.nodeVisits)).toEqual([
            MainNode.COMPLEXITY_ROUTER,
            MainNode.DIRECT_RESPONDER,
            MainNode.FINALIZE,
        ]);
        expect(summary.totalCostUsd).toBeGreaterThan(0);
        expect(summary.profileName).toBe("offline-e2e");
        expect(summary.runId).toMatch(RUN_ID_PATTERN);
    });

    it("(b) pure-reasoning with one strong escalation: router -> frontierArchitect -> claudeArchitect -> finalize", async () => {
        setFakeChatProvider(
            createFakeChatProvider({
                router: ['{"complexity":"pure_reasoning","routeConfidence":0.9}'],
                /* Confidence below the 0.72 threshold flips strongEscalationRequired true. */
                reasoner: [
                    '{"architectureSpec":"Iterative avoids deep stacks; recursion reads clearer.","confidence":0.3,"escalateToStrong":true,"escalationReason":"Low confidence."}',
                ],
                architect: ["Prefer iterative traversal for large or untrusted-depth trees."],
            }),
        );

        const summary = await runAgentTask("Explain the tradeoffs between iterative and recursive tree traversal.", {
            profile: PROFILE,
            budgetUsd: 5,
            tools: localRegistry(),
        });

        const nodes = nodeSequence(summary.nodeVisits);
        expect(summary.status).toBe(RunStatus.COMPLETED);
        expect(nodes).toEqual([
            MainNode.COMPLEXITY_ROUTER,
            MainNode.FRONTIER_ARCHITECT,
            MainNode.CLAUDE_ARCHITECT,
            MainNode.FINALIZE,
        ]);
        expect(nodes).toContain(MainNode.CLAUDE_ARCHITECT);
        expect(summary.answer).toBe("Prefer iterative traversal for large or untrusted-depth trees.");
        expect(summary.totalCostUsd).toBeGreaterThan(0);
    });

    it("(c-pass) tool/code route: patch applies, real typecheck passes, file kept", async () => {
        const work = prepareWork("calc-pass");

        setFakeChatProvider(
            createFakeChatProvider({
                router: ['{"complexity":"tool_complex","routeConfidence":0.92}'],
                worker: [
                    '{"workerKind":"code_explorer"}',
                    `{"thought":"inspect the module","action":{"tool":"ast_read","args":{"path":"${FIXTURE_REL}"}}}`,
                    '{"thought":"have enough","final":"calc.ts exports add(a, b)."}',
                ],
                firewall: ["calc.ts currently exports a single add(a, b) helper."],
                reasoner: [
                    '{"architectureSpec":"Add a sibling sub() helper next to add().","confidence":0.95,"escalateToStrong":false,"escalationReason":""}',
                    '{"consensus":true,"needsMoreContext":false,"confidence":0.95,"requiresStrongCritic":false,"critique":"LGTM"}',
                ],
                coder: [GOOD_PATCH],
            }),
        );

        const summary = await runAgentTask(CODE_TASK, {
            profile: PROFILE,
            budgetUsd: 5,
            applyPatches: true,
            workspaceDir: work.dir,
            tools: localRegistry(),
        });

        expect(summary.verificationPassed).toBe(true);
        expect(summary.status).toBe(RunStatus.COMPLETED);
        expect(nodeSequence(summary.nodeVisits)).toEqual([
            MainNode.COMPLEXITY_ROUTER,
            MainNode.SWARM,
            MainNode.FIREWALL,
            MainNode.FRONTIER_ARCHITECT,
            MainNode.CLAUDE_CODER,
            MainNode.FRONTIER_CRITIC,
            MainNode.APPLY_PATCHES,
            MainNode.VERIFY,
            MainNode.FINALIZE,
        ]);
        expect(readFileSync(work.file, "utf8")).toContain(
            "export const sub = (a: number, b: number): number => a - b;",
        );
        expect(summary.totalCostUsd).toBeGreaterThan(0);
    });

    it("(c-rollback) tool/code route: bad patches fail typecheck twice, finalize rolls back", async () => {
        const work = prepareWork("calc-rollback");
        const original = readFileSync(work.file, "utf8");

        setFakeChatProvider(
            createFakeChatProvider({
                router: ['{"complexity":"tool_complex","routeConfidence":0.92}'],
                worker: [
                    '{"workerKind":"code_explorer"}',
                    `{"thought":"inspect the module","action":{"tool":"ast_read","args":{"path":"${FIXTURE_REL}"}}}`,
                    '{"thought":"have enough","final":"calc.ts exports add(a, b)."}',
                ],
                firewall: ["calc.ts currently exports a single add(a, b) helper."],
                /* frontierArchitect (ordinal 0) then frontierCritic on each of the two loops. */
                reasoner: [
                    '{"architectureSpec":"Add a sibling sub() helper next to add().","confidence":0.95,"escalateToStrong":false,"escalationReason":""}',
                    '{"consensus":true,"needsMoreContext":false,"confidence":0.95,"requiresStrongCritic":false,"critique":"LGTM"}',
                    '{"consensus":true,"needsMoreContext":false,"confidence":0.95,"requiresStrongCritic":false,"critique":"LGTM"}',
                ],
                coder: [badPatch("first-bad"), badPatch("second-bad")],
            }),
        );

        const summary = await runAgentTask(CODE_TASK, {
            profile: PROFILE,
            budgetUsd: 5,
            applyPatches: true,
            workspaceDir: work.dir,
            tools: localRegistry(),
        });

        const nodes = nodeSequence(summary.nodeVisits);
        expect(summary.verificationPassed).toBe(false);
        expect(summary.status).toBe(RunStatus.COMPLETED);
        expect(nodes).toEqual([
            MainNode.COMPLEXITY_ROUTER,
            MainNode.SWARM,
            MainNode.FIREWALL,
            MainNode.FRONTIER_ARCHITECT,
            MainNode.CLAUDE_CODER,
            MainNode.FRONTIER_CRITIC,
            MainNode.APPLY_PATCHES,
            MainNode.VERIFY,
            MainNode.CLAUDE_CODER,
            MainNode.FRONTIER_CRITIC,
            MainNode.APPLY_PATCHES,
            MainNode.VERIFY,
            MainNode.FINALIZE,
        ]);
        expect(nodes.filter((node) => node === MainNode.VERIFY)).toHaveLength(2);
        /* Rollback restored the pristine snapshot byte-for-byte. */
        expect(readFileSync(work.file, "utf8")).toBe(original);
        expect(summary.totalCostUsd).toBeGreaterThan(0);
    });
});
