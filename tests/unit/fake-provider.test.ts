/*
 * R8 offline-run seams (src/models/providers/fake.ts, src/tools/workspace.ts,
 * the swarm profile propagation, and the fake-transport profile schema). No
 * network, gateway, or filesystem writes: the fake provider replays a scripted
 * decision and the workspace seam is exercised against a temp dir.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FailureType, ModelRole, ModelTransport, PROFILE_CONFIG_KEY, WorkerKind, WorkerStatus } from "../../src/consts";
import { createFakeChatProvider, parseProfile } from "../../src/models";
import type { ModelBinding } from "../../src/models";
import { setFakeChatProvider } from "../../src/tools";
import { getWorkspaceRoot, resolveWorkspacePath, setWorkspaceRoot } from "../../src/tools/workspace.ts";
import { leadDelegator } from "../../src/swarm/nodes.ts";
import type { SwarmWorkerStateValue } from "../../src/state";

const workerBinding: ModelBinding = { provider: "deepseek", model: "deepseek/deepseek-v4-flash" };

describe("createFakeChatProvider", () => {
    it("advances a per-role ordinal independently for each role", async () => {
        const provider = createFakeChatProvider({ worker: ["first", "second"], reasoner: ["only"] });

        expect((await provider.call(ModelRole.WORKER, workerBinding, "s", "u")).text).toBe("first");
        expect((await provider.call(ModelRole.REASONER, workerBinding, "s", "u")).text).toBe("only");
        expect((await provider.call(ModelRole.WORKER, workerBinding, "s", "u")).text).toBe("second");
    });

    it("resets the counters on a fresh instance", async () => {
        const script = { worker: ["first", "second"] } as const;
        const first = createFakeChatProvider(script);
        await first.call(ModelRole.WORKER, workerBinding, "s", "u");
        const second = createFakeChatProvider(script);

        expect((await second.call(ModelRole.WORKER, workerBinding, "s", "u")).text).toBe("first");
    });

    it("throws naming the role and ordinal when the script is exhausted", async () => {
        const provider = createFakeChatProvider({ worker: ["only"] });
        await provider.call(ModelRole.WORKER, workerBinding, "s", "u");

        await expect(provider.call(ModelRole.WORKER, workerBinding, "s", "u")).rejects.toThrow(/worker.*ordinal 1/u);
    });

    it("throws naming the role when the role key is missing", async () => {
        const provider = createFakeChatProvider({ worker: ["only"] });

        await expect(provider.call(ModelRole.REASONER, workerBinding, "s", "u")).rejects.toThrow(
            /reasoner.*role not scripted/u,
        );
    });

    it("honors a step's custom usage", async () => {
        const usage = { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 };
        const provider = createFakeChatProvider({ worker: [{ text: "x", usage }] });

        expect((await provider.call(ModelRole.WORKER, workerBinding, "s", "u")).usage).toEqual(usage);
    });

    it("emits the default synthetic usage for a bare string step", async () => {
        const provider = createFakeChatProvider({ worker: ["x"] });

        expect((await provider.call(ModelRole.WORKER, workerBinding, "s", "u")).usage).toEqual({
            prompt_tokens: 120,
            completion_tokens: 40,
            total_tokens: 160,
        });
    });

    it("returns the binding model as the pricing key and reports the fake transport", async () => {
        const provider = createFakeChatProvider({ worker: ["x"] });
        expect(provider.kind).toBe(ModelTransport.FAKE);

        const result = await provider.call(ModelRole.WORKER, workerBinding, "s", "u");
        expect(result.pricingKey).toBe("deepseek/deepseek-v4-flash");
    });

    it("ignores structuredSchema and never sets parsed", async () => {
        const provider = createFakeChatProvider({ worker: ['{"workerKind":"code_explorer"}'] });

        const result = await provider.call(ModelRole.WORKER, workerBinding, "s", "u", {
            structuredSchema: { parse: () => ({}) } as never,
        });
        expect(result).not.toHaveProperty("parsed");
    });
});

describe("workspace root seam", () => {
    afterEach(() => {
        setWorkspaceRoot(undefined);
    });

    it("resolves paths inside an injected workspace root and still bars escapes", () => {
        const root = mkdtempSync(path.join(tmpdir(), "ws-seam-"));
        setWorkspaceRoot(root);

        expect(getWorkspaceRoot()).toBe(root);
        expect(resolveWorkspacePath("sub/file.ts")).toBe(path.resolve(root, "sub/file.ts"));
        expect(() => resolveWorkspacePath("../escape")).toThrow(/escapes workspace/u);
    });

    it("falls back to process.cwd() once the root is reset", () => {
        setWorkspaceRoot(mkdtempSync(path.join(tmpdir(), "ws-seam-")));
        setWorkspaceRoot(undefined);

        expect(getWorkspaceRoot()).toBe(process.cwd());
        expect(resolveWorkspacePath("x.ts")).toBe(path.resolve(process.cwd(), "x.ts"));
    });
});

const fakeProfileInput = {
    name: "fake-test",
    transport: { default: ModelTransport.FAKE },
    tiers: {
        worker: { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
        skilled: { provider: "anthropic", model: "anthropic/claude-sonnet-4-6" },
        adviser: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
        frontier: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
    },
};

describe("fake-transport profile schema", () => {
    it("parses a profile whose default transport is fake", () => {
        const profile = parseProfile(fakeProfileInput, "fake-test");
        expect(profile.transport.default).toBe(ModelTransport.FAKE);
    });

    it("still rejects a fake binding with an unknown pricing key", () => {
        expect(() =>
            parseProfile(
                {
                    ...fakeProfileInput,
                    tiers: {
                        ...fakeProfileInput.tiers,
                        worker: { provider: "deepseek", model: "deepseek/not-a-real-model" },
                    },
                },
                "fake-bad-key",
            ),
        ).toThrow(/model-pricing\.json/u);
    });
});

const swarmState = (overrides: Partial<SwarmWorkerStateValue>): SwarmWorkerStateValue => ({
    subtask: "explore the repo",
    workerKind: WorkerKind.CODE_EXPLORER,
    rawToolOutput: "",
    toolCalls: [],
    attempts: 0,
    status: WorkerStatus.WORKING,
    failureType: FailureType.NONE,
    escalationQuery: "",
    escalationResponse: "",
    escalationAttempts: 0,
    workerSummary: "",
    producedArtifacts: {},
    totalCost: 0,
    totalTokens: 0,
    usageStats: {},
    ...overrides,
});

describe("swarm profile propagation", () => {
    afterEach(() => {
        setFakeChatProvider(undefined);
    });

    it("reaches the scripted provider for a fake-transport profile in config", async () => {
        const profile = parseProfile(fakeProfileInput, "fake-test");
        setFakeChatProvider(createFakeChatProvider({ worker: ['{"workerKind":"code_explorer"}'] }));

        const result = await leadDelegator(swarmState({ workerKind: WorkerKind.INFRA_OPS }), {
            configurable: { [PROFILE_CONFIG_KEY]: profile },
        });

        /* The seed was INFRA_OPS; CODE_EXPLORER proves the scripted decision flowed
           back through the fake transport rather than the heuristic fallback. */
        expect(result.workerKind).toBe(WorkerKind.CODE_EXPLORER);
    });
});
