/*
 * Tests for the R2 profile subsystem (src/models), updated for the R6a tier layer.
 * They (1) pin the loader's fail-fast guards across tier bindings and role
 * overrides, (2) assert resolveBinding(role, defaultProfile) still reproduces the
 * pre-refactor modelForRole switch for every ModelRole (byte-equivalent migration),
 * (3) pin the resolution precedence (default tier / tier reassignment / param merge
 * / full override), and (4) check the tuning merge defaults. The EXPECTED_BINDINGS
 * table below is the byte-stability contract for profiles/default.json5.
 */
import { describe, expect, it } from "vitest";
import { loadProfile, parseProfile, type ModelBinding } from "../../src/models/profile.ts";
import {
    DEFAULT_ROLE_TIER,
    effectiveTransports,
    readProfile,
    resolveBinding,
    resolveTuning,
} from "../../src/models/resolve.ts";
import { callLlm } from "../../src/tools/llm.ts";
import { ModelRole, ModelTier, ModelTransport } from "../../src/consts/models.ts";
import {
    CONFIDENCE_ESCALATION_THRESHOLD,
    DEFAULT_LLM_MAX_RETRIES,
    MAX_CONTEXT_FETCHES,
    MAX_DEBATE_ITERATIONS,
    MAX_PATCH_FORMAT_RETRIES,
    MAX_REACT_STEPS,
    MAX_VERIFY_ATTEMPTS,
} from "../../src/consts/tuning.ts";

/* The full resolved binding for every role in profiles/default.json5 — mirrors the
   pre-refactor modelForRole switch plus the provider/transport the byte-equivalent
   migration must preserve. resolveBinding(role, default) must deep-equal these, so a
   changed provider or an added per-binding transport is caught, not just model/params. */
const EXPECTED_BINDINGS: Record<ModelRole, ModelBinding> = {
    [ModelRole.ROUTER]: {
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        params: { temperature: 0, thinking: "disabled" },
    },
    [ModelRole.FIREWALL]: {
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        params: { temperature: 0, thinking: "disabled" },
    },
    [ModelRole.WORKER]: {
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        params: { temperature: 0, thinking: "disabled" },
    },
    [ModelRole.REASONER]: {
        provider: "deepseek",
        model: "deepseek/deepseek-v4-pro",
        params: { temperature: 0.2, thinking: "enabled", reasoningEffort: "high" },
    },
    [ModelRole.ARCHITECT]: {
        provider: "anthropic",
        model: "anthropic/claude-opus-4-8",
        params: { thinking: "adaptive", reasoningEffort: "high" },
    },
    [ModelRole.SME]: {
        provider: "anthropic",
        model: "anthropic/claude-opus-4-8",
        params: { thinking: "adaptive", reasoningEffort: "high" },
    },
    [ModelRole.CODER]: {
        provider: "anthropic",
        model: "anthropic/claude-sonnet-4-6",
        params: { temperature: 0.2 },
    },
    [ModelRole.CRITIC]: {
        provider: "openai",
        model: "openai/gpt-5.5",
        params: { temperature: 0.1 },
    },
};

type RawBinding = { provider: string; model: string; transport?: string; params?: Record<string, unknown> };

/* Four gateway-prefixed tier bindings (openclaw transport), every model priced. */
const validTiers = (): Record<string, RawBinding> => ({
    worker: {
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        params: { temperature: 0, thinking: "disabled" },
    },
    skilled: { provider: "anthropic", model: "anthropic/claude-sonnet-4-6", params: { temperature: 0.2 } },
    adviser: {
        provider: "anthropic",
        model: "anthropic/claude-opus-4-8",
        params: { thinking: "adaptive", reasoningEffort: "high" },
    },
    frontier: {
        provider: "anthropic",
        model: "anthropic/claude-opus-4-8",
        params: { thinking: "adaptive", reasoningEffort: "high" },
    },
});

/* Provider-native bare ids (no gateway "provider/" prefix) — required on the
   direct transport; every id has a model-pricing.json entry. */
const bareTiers = (): Record<string, RawBinding> => ({
    worker: { provider: "deepseek", model: "deepseek-v4-flash" },
    skilled: { provider: "anthropic", model: "claude-sonnet-4-6" },
    adviser: { provider: "anthropic", model: "claude-opus-4-8" },
    frontier: { provider: "anthropic", model: "claude-opus-4-8" },
});

/* Four DISTINCT, priced, gateway-prefixed tier bindings: each tier resolves to a
   different model, so every role→tier mapping is observable. The default profile
   masks this — reasoner/critic use full overrides and its frontier tier is
   byte-identical to adviser — so a wrong DEFAULT_ROLE_TIER entry hides there. */
const distinctTiers = (): Record<ModelTier, RawBinding> => ({
    [ModelTier.WORKER]: { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
    [ModelTier.SKILLED]: { provider: "anthropic", model: "anthropic/claude-sonnet-4-6" },
    [ModelTier.ADVISER]: { provider: "openai", model: "openai/gpt-5.5" },
    [ModelTier.FRONTIER]: { provider: "anthropic", model: "anthropic/claude-opus-4-8" },
});

/* The normative role→tier map (design §3). The single source of truth in this
   suite: it pins DEFAULT_ROLE_TIER directly and drives the distinct-tier
   resolution check below, independent of the implementation under test. */
const SPEC_ROLE_TIER: Record<ModelRole, ModelTier> = {
    [ModelRole.ROUTER]: ModelTier.WORKER,
    [ModelRole.FIREWALL]: ModelTier.WORKER,
    [ModelRole.WORKER]: ModelTier.WORKER,
    [ModelRole.CODER]: ModelTier.SKILLED,
    [ModelRole.REASONER]: ModelTier.ADVISER,
    [ModelRole.ARCHITECT]: ModelTier.ADVISER,
    [ModelRole.CRITIC]: ModelTier.ADVISER,
    [ModelRole.SME]: ModelTier.FRONTIER,
};

const validProfile = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: "test",
    transport: { default: "openclaw" },
    tiers: validTiers(),
    ...overrides,
});

describe("loadProfile (default)", () => {
    it("loads the default profile on the openclaw transport with all four tiers", () => {
        const profile = loadProfile("default");
        expect(profile.name).toBe("default");
        expect(profile.transport.default).toBe("openclaw");
        for (const tier of Object.values(ModelTier)) {
            expect(profile.tiers[tier]).toBeDefined();
        }
        for (const role of Object.values(ModelRole)) {
            expect(() => resolveBinding(role, profile)).not.toThrow();
        }
    });
});

describe("shipped profiles load and validate (R6)", () => {
    /* Every profile shipped under profiles/ must pass the loader's fail-fast
       guards (schema, pricing entries, direct-id form) and resolve all 8 roles,
       so a broken example profile is caught in CI, not at first live use. */
    const SHIPPED_PROFILES = ["default", "personal-dev", "research-playground", "client-baseline"];
    for (const name of SHIPPED_PROFILES) {
        it(`loads "${name}" and resolves a binding for every role`, () => {
            const profile = loadProfile(name);
            expect(profile.name).toBe(name);
            for (const role of Object.values(ModelRole)) {
                const binding = resolveBinding(role, profile);
                expect(binding.model.length).toBeGreaterThan(0);
            }
        });
    }
});

describe("resolveBinding reproduces the pre-refactor switch", () => {
    const profile = loadProfile("default");
    for (const role of Object.values(ModelRole)) {
        it(`binds role "${role}" to today's full binding (provider, model, transport, params)`, () => {
            expect(resolveBinding(role, profile)).toEqual(EXPECTED_BINDINGS[role]);
        });
    }
});

describe("DEFAULT_ROLE_TIER contract (design §3)", () => {
    it("maps every role to its normative spec-§3 tier", () => {
        expect(DEFAULT_ROLE_TIER).toEqual(SPEC_ROLE_TIER);
    });

    it("resolves every no-override role through its spec tier", () => {
        const tiers = distinctTiers();
        const profile = parseProfile(validProfile({ tiers }));
        for (const role of Object.values(ModelRole)) {
            expect(resolveBinding(role, profile).model).toBe(tiers[SPEC_ROLE_TIER[role]].model);
        }
    });
});

describe("resolveBinding tier precedence", () => {
    it("resolves a role with no override via its DEFAULT_ROLE_TIER tier", () => {
        const profile = parseProfile(validProfile());
        const binding = resolveBinding(ModelRole.CODER, profile);
        /* coder defaults to the skilled tier. */
        expect(binding.model).toBe("anthropic/claude-sonnet-4-6");
        expect(binding.params).toEqual({ temperature: 0.2 });
    });

    it("resolves a { tier } reassignment via the named tier", () => {
        const profile = parseProfile(validProfile({ roles: { coder: { tier: "adviser" } } }));
        const binding = resolveBinding(ModelRole.CODER, profile);
        expect(binding.model).toBe("anthropic/claude-opus-4-8");
        expect(binding.params).toEqual({ thinking: "adaptive", reasoningEffort: "high" });
    });

    it("merges { tier, params } with role params winning key-by-key over the tier params", () => {
        const profile = parseProfile(
            validProfile({
                roles: { coder: { tier: "adviser", params: { reasoningEffort: "low", temperature: 0.5 } } },
            }),
        );
        const binding = resolveBinding(ModelRole.CODER, profile);
        expect(binding.model).toBe("anthropic/claude-opus-4-8");
        /* thinking kept from the tier; reasoningEffort overridden; temperature added. */
        expect(binding.params).toEqual({ thinking: "adaptive", reasoningEffort: "low", temperature: 0.5 });
    });

    it("returns a full-binding override verbatim, bypassing the default tier", () => {
        const profile = parseProfile(
            validProfile({
                roles: { critic: { provider: "openai", model: "openai/gpt-5.5", params: { temperature: 0.1 } } },
            }),
        );
        const binding = resolveBinding(ModelRole.CRITIC, profile);
        /* critic defaults to the adviser (opus) tier; the override wins outright. */
        expect(binding.provider).toBe("openai");
        expect(binding.model).toBe("openai/gpt-5.5");
        expect(binding.params).toEqual({ temperature: 0.1 });
    });

    it("omits params when neither the tier binding nor an override contributes one", () => {
        const profile = parseProfile(validProfile({ tiers: bareTiers() }));
        const binding = resolveBinding(ModelRole.ROUTER, profile);
        expect(binding.model).toBe("deepseek-v4-flash");
        expect(binding.params).toBeUndefined();
    });
});

describe("loadProfile fail-fast validation", () => {
    it("accepts a complete valid profile object", () => {
        expect(() => parseProfile(validProfile())).not.toThrow();
    });

    it("rejects a profile missing a tier", () => {
        const tiers = validTiers();
        delete tiers.frontier;
        expect(() => parseProfile(validProfile({ tiers }))).toThrow();
    });

    it("rejects an unknown provider on a tier binding", () => {
        const tiers = validTiers();
        tiers.worker = { provider: "google", model: "deepseek/deepseek-v4-flash" };
        expect(() => parseProfile(validProfile({ tiers }))).toThrow();
    });

    it("rejects a tier binding without a model-pricing.json entry", () => {
        const tiers = validTiers();
        tiers.skilled = { provider: "anthropic", model: "anthropic/claude-does-not-exist" };
        expect(() => parseProfile(validProfile({ tiers }))).toThrow(/model-pricing/u);
    });

    it("rejects a full-binding role override without a model-pricing.json entry", () => {
        const roles = { critic: { provider: "anthropic", model: "anthropic/claude-does-not-exist" } };
        expect(() => parseProfile(validProfile({ roles }))).toThrow(/model-pricing/u);
    });

    it("rejects an override that mixes a tier with a full binding (strictness)", () => {
        const roles = { coder: { tier: "adviser", provider: "anthropic", model: "anthropic/claude-opus-4-8" } };
        expect(() => parseProfile(validProfile({ roles }))).toThrow();
    });

    it("rejects an unknown tier name on a reassignment override", () => {
        const roles = { coder: { tier: "nonexistent" } };
        expect(() => parseProfile(validProfile({ roles }))).toThrow();
    });
});

describe("direct transport rejects gateway-prefixed model ids", () => {
    it("rejects a prefixed id on a tier binding when transport.default is direct", () => {
        expect(() => parseProfile(validProfile({ transport: { default: "direct" } }))).toThrow(/gateway-prefixed/u);
    });

    it("rejects a prefixed id via a per-tier-binding transport override", () => {
        const tiers = validTiers();
        tiers.skilled = { provider: "anthropic", model: "anthropic/claude-sonnet-4-6", transport: "direct" };
        expect(() => parseProfile(validProfile({ tiers }))).toThrow(/gateway-prefixed/u);
    });

    it("still loads a prefixed id whose tier binding overrides transport back to openclaw", () => {
        const tiers = bareTiers();
        tiers.skilled = { provider: "anthropic", model: "anthropic/claude-sonnet-4-6", transport: "openclaw" };
        expect(() => parseProfile(validProfile({ transport: { default: "direct" }, tiers }))).not.toThrow();
    });
});

describe("readProfile validates configurable profiles", () => {
    it("falls back to the default profile when none is injected", () => {
        expect(readProfile(undefined).name).toBe("default");
        expect(readProfile({ configurable: {} }).name).toBe("default");
    });

    it("re-validates an unvalidated profile injected via configurable", () => {
        const tiers = validTiers();
        delete tiers.frontier;
        const invalid = validProfile({ tiers });
        expect(() => readProfile({ configurable: { profile: invalid } })).toThrow();
    });

    it("trusts a profile that already passed parseProfile", () => {
        const profile = parseProfile(validProfile());
        expect(readProfile({ configurable: { profile } })).toBe(profile);
    });
});

describe("callLlm transport dispatch", () => {
    it("routes a direct-transport binding to the direct provider, not the gateway", async () => {
        /* R3 replaced the R2 fail-fast guard with real dispatch. Without an API
           key the direct Anthropic model throws at construction — proof the call
           reached the direct provider (the gateway path never needs that key). */
        const previousKey = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try {
            /* Bare provider-native ids: the direct-transport guard rejects
               gateway-prefixed ids, so the dispatch proof uses bare bindings.
               coder resolves to the skilled (anthropic) tier. */
            const profile = parseProfile(validProfile({ transport: { default: "direct" }, tiers: bareTiers() }));
            await expect(callLlm(ModelRole.CODER, "system", "user", {}, { configurable: { profile } })).rejects.toThrow(
                /Anthropic API key/iu,
            );
        } finally {
            if (previousKey !== undefined) {
                process.env.ANTHROPIC_API_KEY = previousKey;
            }
        }
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

/* effectiveTransports drives the entry point's gateway-skip decision: it must
   report exactly the transports some role actually resolves to. */
describe("effectiveTransports", () => {
    it("reports only openclaw for the default openclaw profile", () => {
        expect([...effectiveTransports(parseProfile(validProfile()))]).toEqual([ModelTransport.OPENCLAW]);
    });

    it("reports only direct for an all-direct profile", () => {
        const profile = parseProfile(validProfile({ transport: { default: "direct" }, tiers: bareTiers() }));
        expect([...effectiveTransports(profile)]).toEqual([ModelTransport.DIRECT]);
    });

    it("reports both when a USED tier overrides the default transport to openclaw", () => {
        const tiers = bareTiers();
        /* coder resolves to skilled, so this openclaw override is effective. */
        tiers.skilled = { provider: "anthropic", model: "anthropic/claude-sonnet-4-6", transport: "openclaw" };
        const transports = effectiveTransports(parseProfile(validProfile({ transport: { default: "direct" }, tiers })));
        expect(transports.has(ModelTransport.DIRECT)).toBe(true);
        expect(transports.has(ModelTransport.OPENCLAW)).toBe(true);
    });

    it("excludes the transport of a tier no role resolves to", () => {
        const tiers = bareTiers();
        /* Make frontier openclaw, then move its only consumer (sme) off it with a
           direct full-binding override: frontier is now unused, so no role is openclaw. */
        tiers.frontier = { provider: "anthropic", model: "anthropic/claude-opus-4-8", transport: "openclaw" };
        const profile = parseProfile(
            validProfile({
                transport: { default: "direct" },
                tiers,
                roles: { sme: { provider: "anthropic", model: "claude-sonnet-4-6" } },
            }),
        );
        expect([...effectiveTransports(profile)]).toEqual([ModelTransport.DIRECT]);
    });
});
