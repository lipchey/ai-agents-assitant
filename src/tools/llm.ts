/* Thin shim over the ChatProvider seam (R3): resolve the binding from the
   active profile, dispatch by transport, and keep cost accounting in exactly
   one place — raw provider usage priced against ChatResult.pricingKey. */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ModelTransport } from "../consts";
import type { ModelRole } from "../consts";
import { getLogger } from "../logging";
import {
    createDirectChatProvider,
    createOpenClawChatProvider,
    readProfile,
    resolveBinding,
    resolveTuning,
} from "../models";
import type { ChatCallOptions, ChatProvider, ChatRetryListener } from "../models";
import { OpenClawError } from "./errors.ts";
import { jsonPost } from "./http.ts";
import { calculateUsage, loadPricing } from "./pricing.ts";
import type { LlmCallOptions, LlmCallResult } from "../types/tools";

export type { LlmCallOptions, LlmCallResult } from "../types/tools";

const logChatRetry: ChatRetryListener = (info, context) => {
    getLogger().child({ module: "llm" }).warn("Transient LLM transport failure; retrying.", {
        role: context.role,
        model: context.model,
        transport: context.transport,
        attempt: info.attempt,
        maxRetries: info.maxRetries,
        delayMs: info.delayMs,
        error: info.error,
    });
};

let providerRegistry: Record<ModelTransport, ChatProvider> | undefined;

/* Lazily built so module load stays side-effect free for the barrel. */
const chatProviderFor = (transport: ModelTransport): ChatProvider => {
    providerRegistry ??= {
        [ModelTransport.OPENCLAW]: createOpenClawChatProvider({
            post: jsonPost,
            createError: (message) => new OpenClawError(message),
            onRetry: logChatRetry,
        }),
        [ModelTransport.DIRECT]: createDirectChatProvider({ onRetry: logChatRetry }),
    };
    return providerRegistry[transport];
};

export const callLlm = async (
    role: ModelRole,
    system: string,
    user: string,
    options: LlmCallOptions = {},
    config?: LangGraphRunnableConfig,
): Promise<LlmCallResult> => {
    const profile = readProfile(config);
    const binding = resolveBinding(role, profile);
    const provider = chatProviderFor(binding.transport ?? profile.transport.default);
    /* binding.params carries the role/model-tied tuning (temperature, thinking,
       effort); per-call options (maxTokens, responseFormat) override per request. */
    const merged: ChatCallOptions = {
        ...binding.params,
        ...options,
        maxRetries: resolveTuning(profile).llmMaxRetries,
    };

    const result = await provider.call(role, binding, system, user, merged);

    const pricing = (await loadPricing())[result.pricingKey];
    const usage = calculateUsage(result.usage, pricing);
    /* parsed is forwarded only when the provider honored structuredSchema, so
       parse sites can use `parsed ?? text-fallback` without presence checks. */
    return result.parsed === undefined
        ? { content: result.text, ...usage }
        : { content: result.text, parsed: result.parsed, ...usage };
};
