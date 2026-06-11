/*
 * Tests for the R2 profile subsystem (src/models). They (1) pin the loader's
 * fail-fast guards, (2) assert resolveBinding(role, defaultProfile) reproduces the
 * pre-refactor modelForRole switch for every ModelRole, and (3) check the tuning
 * merge defaults to the src/consts/tuning.ts values. The regression table below is
 * the byte-stability contract for profiles/default.json5.
 */
import { describe, expect, it } from "vitest";
import { loadProfile, parseProfile } from "../../src/models/profile.ts";
import { readProfile, resolveBinding, resolveTuning } from "../../src/models/resolve.ts";
import { callLlm } from "../../src/tools/llm.ts";
import { ModelRole } from "../../src/consts/models.ts";
import {
    CONFIDENCE_ESCALATION_THRESHOLD,
    DEFAULT_LLM_MAX_RETRIES,
    MAX_CONTEXT_FETCHES,
    MAX_DEBATE_ITERATIONS,
    MAX_PATCH_FORMAT_RETRIES,
    MAX_REACT_STEPS,
    MAX_VERIFY_ATTEMPTS,
} from "../../src/consts/tuning.ts";

/* Mirrors the modelForRole switch + the model-tied call-site options it replaced. */
const EXPECTED_BINDINGS: Record<ModelRole, { model: string; params: Record<string, unknown> }> = {
    [ModelRole.ROUTER]: { model: "deepseek/deepseek-v4-flash", params: { temperature: 0, thinking: "disabled" } },
    [ModelRole.FIREWALL]: { model: "deepseek/deepseek-v4-flash", params: { temperature: 0, thinking: "disabled" } },
    [ModelRole.WORKER]: { model: "deepseek/deepseek-v4-flash", params: { temperature: 0, thinking: "disabled" } },
    [ModelRole.FRONTIER]: {
        model: "deepseek/deepseek-v4-pro",
        params: { temperature: 0.2, thinking: "enabled", reasoningEffort: "high" },
    },
    [ModelRole.ARCHITECT]: {
        model: "anthropic/claude-opus-4-8",
        params: { thinking: "adaptive", reasoningEffort: "high" },
    },
    [ModelRole.SME]: {
        model: "anthropic/claude-opus-4-8",
        params: { thinking: "adaptive", reasoningEffort: "high" },
    },
    [ModelRole.CODER]: { model: "anthropic/claude-sonnet-4-6", params: { temperature: 0.2 } },
    [ModelRole.CRITIC]: { model: "openai/gpt-5.5", params: { temperature: 0.1 } },
};

const validRoles = (): Record<string, { provider: string; model: string }> => ({
    router: { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
    firewall: { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
    worker: { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
    frontier: { provider: "deepseek", model: "deepseek/deepseek-v4-pro" },
    architect: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
    sme: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
    coder: { provider: "anthropic", model: "anthropic/claude-sonnet-4-6" },
    critic: { provider: "openai", model: "openai/gpt-5.5" },
});

const validProfile = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: "test",
    transport: { default: "openclaw" },
    roles: validRoles(),
    ...overrides,
});

describe("loadProfile (default)", () => {
    it("loads the default profile on the openclaw transport with all roles", () => {
        const profile = loadProfile("default");
        expect(profile.name).toBe("default");
        expect(profile.transport.default).toBe("openclaw");
        for (const role of Object.values(ModelRole)) {
            expect(profile.roles[role]).toBeDefined();
        }
    });
});

describe("resolveBinding reproduces the pre-refactor switch", () => {
    const profile = loadProfile("default");
    for (const role of Object.values(ModelRole)) {
        it(`binds role "${role}" to today's model and params`, () => {
            const binding = resolveBinding(role, profile);
            expect(binding.model).toBe(EXPECTED_BINDINGS[role].model);
            expect(binding.params).toEqual(EXPECTED_BINDINGS[role].params);
        });
    }
});

describe("loadProfile fail-fast validation", () => {
    it("accepts a complete valid profile object", () => {
        expect(() => parseProfile(validProfile())).not.toThrow();
    });

    it("rejects a profile missing a role", () => {
        const roles = validRoles();
        delete roles.sme;
        expect(() => parseProfile(validProfile({ roles }))).toThrow();
    });

    it("rejects an unknown provider", () => {
        const roles = validRoles();
        roles.router = { provider: "google", model: "deepseek/deepseek-v4-flash" };
        expect(() => parseProfile(validProfile({ roles }))).toThrow();
    });

    it("rejects a model without a model-pricing.json entry", () => {
        const roles = validRoles();
        roles.coder = { provider: "anthropic", model: "anthropic/claude-does-not-exist" };
        expect(() => parseProfile(validProfile({ roles }))).toThrow(/model-pricing/u);
    });
});

describe("readProfile validates configurable profiles", () => {
    it("falls back to the default profile when none is injected", () => {
        expect(readProfile(undefined).name).toBe("default");
        expect(readProfile({ configurable: {} }).name).toBe("default");
    });

    it("re-validates an unvalidated profile injected via configurable", () => {
        const roles = validRoles();
        delete roles.sme;
        const invalid = validProfile({ roles });
        expect(() => readProfile({ configurable: { profile: invalid } })).toThrow();
    });

    it("trusts a profile that already passed parseProfile", () => {
        const profile = parseProfile(validProfile());
        expect(readProfile({ configurable: { profile } })).toBe(profile);
    });
});

describe("callLlm transport guard", () => {
    it("rejects a binding that resolves to a transport other than openclaw", async () => {
        const profile = parseProfile(validProfile({ transport: { default: "direct" } }));
        await expect(callLlm(ModelRole.CODER, "system", "user", {}, { configurable: { profile } })).rejects.toThrow(
            /transport/iu,
        );
    });
});

describe("resolveTuning", () => {
    it("defaults every cap to the consts when the profile omits tuning", () => {
        expect(resolveTuning(loadProfile("default"))).toEqual({
            confidenceEscalationThreshold: CONFIDENCE_ESCALATION_THRESHOLD,
            maxDebateIterations: MAX_DEBATE_ITERATIONS,
            maxVerifyAttempts: MAX_VERIFY_ATTEMPTS,
            maxContextFetches: MAX_CONTEXT_FETCHES,
            maxPatchFormatRetries: MAX_PATCH_FORMAT_RETRIES,
            maxReactSteps: MAX_REACT_STEPS,
            llmMaxRetries: DEFAULT_LLM_MAX_RETRIES,
        });
    });

    it("overrides only the provided keys and keeps consts for the rest", () => {
        const profile = parseProfile(validProfile({ tuning: { maxDebateIterations: 9 } }));
        const tuning = resolveTuning(profile);
        expect(tuning.maxDebateIterations).toBe(9);
        expect(tuning.maxVerifyAttempts).toBe(MAX_VERIFY_ATTEMPTS);
        expect(tuning.confidenceEscalationThreshold).toBe(CONFIDENCE_ESCALATION_THRESHOLD);
    });
});
