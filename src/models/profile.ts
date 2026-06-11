/* Profile = role->model bindings, params, caps, and policy as data (spec §3.2).
   Loaded from profiles/<name>.json5, validated by zod, fail-fast on a missing
   role, an unknown provider, or a model without a model-pricing.json entry. */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { z } from "zod";
import {
    DEFAULT_PROFILE_NAME,
    ModelProvider,
    ModelRole,
    ModelTransport,
    ReasoningEffort,
    RESPONSE_FORMAT_JSON,
    ThinkingMode,
} from "../consts";

const providerSchema = z.enum([ModelProvider.ANTHROPIC, ModelProvider.OPENAI, ModelProvider.DEEPSEEK]);
const transportSchema = z.enum([ModelTransport.DIRECT, ModelTransport.OPENCLAW]);
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
    ModelRole.FRONTIER,
    ModelRole.ARCHITECT,
    ModelRole.CODER,
    ModelRole.CRITIC,
    ModelRole.SME,
    ModelRole.WORKER,
    ModelRole.FIREWALL,
]);

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
    /* z.record over the role enum is exhaustive: a missing role fails validation. */
    roles: z.record(roleSchema, modelBindingSchema),
    budget: z.object({ costBudgetUsd: z.number().positive() }).optional(),
    tuning: tuningSchema.optional(),
    workerTools: z.record(z.string(), z.array(z.string())).optional(),
    prompts: z.object({ cascadeNote: z.string().optional() }).optional(),
});

export type ModelParams = z.infer<typeof modelParamsSchema>;
export type ModelBinding = z.infer<typeof modelBindingSchema>;
export type ProfileTuning = z.infer<typeof tuningSchema>;
export type Profile = z.infer<typeof profileSchema>;

let pricingKeyCache: Set<string> | undefined;

const pricingKeys = (): Set<string> => {
    if (!pricingKeyCache) {
        const file = readFileSync(path.join(process.cwd(), "src", "consts", "pricing", "model-pricing.json"), "utf8");
        pricingKeyCache = new Set(Object.keys(JSON.parse(file) as Record<string, unknown>));
    }
    return pricingKeyCache;
};

/* model doubles as the cost-lookup key; a binding without a pricing entry would
   silently bill at zero, so reject it at load time. */
const assertPricingEntries = (profile: Profile, sourceLabel: string): void => {
    const keys = pricingKeys();
    for (const [role, binding] of Object.entries(profile.roles)) {
        if (!keys.has(binding.model)) {
            throw new Error(
                `Profile ${sourceLabel} role "${role}" model "${binding.model}" has no entry in model-pricing.json.`,
            );
        }
    }
};

export const parseProfile = (raw: unknown, sourceLabel = "<inline>"): Profile => {
    const profile = profileSchema.parse(raw);
    assertPricingEntries(profile, sourceLabel);
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
