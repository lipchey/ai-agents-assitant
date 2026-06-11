/* Profile = tier->model bindings plus optional role overrides, params, caps, and
   policy as data (spec §2, model-tiers design). Loaded from profiles/<name>.json5,
   validated by zod, fail-fast on a missing tier, an unknown provider, a malformed
   override, or a model without a model-pricing.json entry. */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import {
    DEFAULT_PROFILE_NAME,
    ModelProvider,
    ModelRole,
    ModelTier,
    ModelTransport,
    ReasoningEffort,
    RESPONSE_FORMAT_JSON,
    ThinkingMode,
} from "../consts";

const providerSchema = z.enum([ModelProvider.ANTHROPIC, ModelProvider.OPENAI, ModelProvider.DEEPSEEK]);
const transportSchema = z.enum([ModelTransport.DIRECT, ModelTransport.OPENCLAW, ModelTransport.FAKE]);
const thinkingSchema = z.enum([ThinkingMode.ADAPTIVE, ThinkingMode.ENABLED, ThinkingMode.DISABLED]);
const effortSchema = z.enum([
    ReasoningEffort.LOW,
    ReasoningEffort.MEDIUM,
    ReasoningEffort.HIGH,
    ReasoningEffort.XHIGH,
    ReasoningEffort.MAX,
]);
const roleSchema = z.enum([
    ModelRole.ROUTER,
    ModelRole.REASONER,
    ModelRole.ARCHITECT,
    ModelRole.CODER,
    ModelRole.CRITIC,
    ModelRole.SME,
    ModelRole.WORKER,
    ModelRole.FIREWALL,
]);
const tierSchema = z.enum([ModelTier.FRONTIER, ModelTier.ADVISER, ModelTier.SKILLED, ModelTier.WORKER]);

/* The role/model-tied tuning subset. Per-call options (maxTokens, responseFormat)
   stay at the call sites and override these; callLlm merges call-site over params. */
const modelParamsSchema = z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    thinking: thinkingSchema.optional(),
    reasoningEffort: effortSchema.optional(),
    responseFormat: z.literal(RESPONSE_FORMAT_JSON).optional(),
});

const modelBindingSchema = z.object({
    provider: providerSchema,
    model: z.string().min(1),
    transport: transportSchema.optional(),
    params: modelParamsSchema.optional(),
});

/* All four tiers required: a profile defines the whole cascade as data, and a
   missing tier would silently strand any role that defaults to it. */
const tierBindingsSchema = z.object({
    [ModelTier.FRONTIER]: modelBindingSchema,
    [ModelTier.ADVISER]: modelBindingSchema,
    [ModelTier.SKILLED]: modelBindingSchema,
    [ModelTier.WORKER]: modelBindingSchema,
});

/* A per-role override is one of two mutually exclusive STRICT shapes:
     a) a full ModelBinding (has provider+model)  -> bypasses the tier layer,
     b) { tier, params? }                          -> reassign tier and/or merge params.
   Both are strict so the shapes cannot mix: an object carrying both `provider`
   and `tier` is rejected rather than silently half-applied (design §2, §10). */
const roleOverrideSchema = z.union([
    modelBindingSchema.strict(),
    z.strictObject({ tier: tierSchema, params: modelParamsSchema.optional() }),
]);

/* Every key optional; resolveTuning() fills the gaps from src/consts/tuning.ts. */
const tuningSchema = z.object({
    confidenceEscalationThreshold: z.number().optional(),
    maxDebateIterations: z.number().int().optional(),
    maxVerifyAttempts: z.number().int().optional(),
    maxContextFetches: z.number().int().optional(),
    maxPatchFormatRetries: z.number().int().optional(),
    maxReactSteps: z.number().int().optional(),
    llmMaxRetries: z.number().int().optional(),
});

const profileSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    transport: z.object({ default: transportSchema }),
    tiers: tierBindingsSchema,
    /* Optional partial map over the role enum; a role with no override resolves
       through DEFAULT_ROLE_TIER (src/models/resolve.ts). */
    roles: z.partialRecord(roleSchema, roleOverrideSchema).optional(),
    budget: z.object({ costBudgetUsd: z.number().positive() }).optional(),
    tuning: tuningSchema.optional(),
    workerTools: z.record(z.string(), z.array(z.string())).optional(),
    prompts: z.object({ cascadeNote: z.string().optional() }).optional(),
});

export type ModelParams = z.infer<typeof modelParamsSchema>;
export type ModelBinding = z.infer<typeof modelBindingSchema>;
export type RoleOverride = z.infer<typeof roleOverrideSchema>;
export type ProfileTuning = z.infer<typeof tuningSchema>;
export type Profile = z.infer<typeof profileSchema>;

/* A full-binding override has provider+model and no `tier`; the tier-reassignment
   shape is the one carrying `tier`. Used to apply the load-time binding checks to
   the right positions and to drive resolveBinding's precedence. */
export const isFullBinding = (override: RoleOverride): override is ModelBinding => !("tier" in override);

/* Profiles that have passed parseProfile, so the configurable accessor can trust a
   re-injected object by identity without re-validating on every hot-path read. */
const validatedProfiles = new WeakSet<object>();

export const isValidatedProfile = (value: unknown): value is Profile =>
    typeof value === "object" && value !== null && validatedProfiles.has(value);

let pricingKeyCache: Set<string> | undefined;

const pricingKeys = (): Set<string> => {
    if (!pricingKeyCache) {
        const file = readFileSync(path.join(process.cwd(), "src", "consts", "pricing", "model-pricing.json"), "utf8");
        pricingKeyCache = new Set(Object.keys(JSON.parse(file) as Record<string, unknown>));
    }
    return pricingKeyCache;
};

/* model doubles as the cost-lookup key; a binding without a pricing entry would
   silently bill at zero, so reject it at load time — across every tier binding and
   every full-binding role override (tier-reassignment overrides carry no model). */
const assertPricingEntries = (profile: Profile, sourceLabel: string): void => {
    const keys = pricingKeys();
    const check = (position: string, model: string): void => {
        if (!keys.has(model)) {
            throw new Error(`Profile ${sourceLabel} ${position} model "${model}" has no entry in model-pricing.json.`);
        }
    };
    for (const [tier, binding] of Object.entries(profile.tiers)) {
        check(`tier "${tier}"`, binding.model);
    }
    for (const [role, override] of Object.entries(profile.roles ?? {})) {
        if (isFullBinding(override)) {
            check(`role "${role}"`, override.model);
        }
    }
};

/* The direct transport feeds binding.model straight into the provider SDK, so it
   must be a provider-native bare id. A gateway-style "provider/model" ref (the
   only form containing a slash) would defeat the id-prefix model mapping
   (ANTHROPIC_FIXED_SAMPLING_MODEL_IDS et al.) and be rejected by the provider
   API, yet still pass the pricing check because both forms are priced — so reject
   it at load time on the effective transport — across tier bindings and
   full-binding role overrides alike (tier-reassignment overrides carry no model). */
const assertDirectModelIds = (profile: Profile, sourceLabel: string): void => {
    const check = (position: string, binding: ModelBinding): void => {
        const transport = binding.transport ?? profile.transport.default;
        if (transport === ModelTransport.DIRECT && binding.model.includes("/")) {
            throw new Error(
                `Profile ${sourceLabel} ${position} model "${binding.model}" is a gateway-prefixed id on the direct transport; direct bindings require a provider-native id with no "/".`,
            );
        }
    };
    for (const [tier, binding] of Object.entries(profile.tiers)) {
        check(`tier "${tier}"`, binding);
    }
    for (const [role, override] of Object.entries(profile.roles ?? {})) {
        if (isFullBinding(override)) {
            check(`role "${role}"`, override);
        }
    }
};

export const parseProfile = (raw: unknown, sourceLabel = "<inline>"): Profile => {
    const profile = profileSchema.parse(raw);
    assertPricingEntries(profile, sourceLabel);
    assertDirectModelIds(profile, sourceLabel);
    validatedProfiles.add(profile);
    return profile;
};

const resolveProfilePath = (nameOrPath: string): string => {
    const looksLikePath = nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.endsWith(".json5");
    if (looksLikePath) {
        return path.isAbsolute(nameOrPath) ? nameOrPath : path.join(process.cwd(), nameOrPath);
    }
    return path.join(process.cwd(), "profiles", `${nameOrPath}.json5`);
};

export const loadProfile = (nameOrPath: string = DEFAULT_PROFILE_NAME): Profile => {
    const filePath = resolveProfilePath(nameOrPath);
    const raw: unknown = JSON5.parse(readFileSync(filePath, "utf8"));
    return parseProfile(raw, nameOrPath);
};
