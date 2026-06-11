/* Direct LangChain transport (spec D1): provider SDKs called without the
   OpenClaw gateway. Option mapping honors current Anthropic API semantics —
   adaptive thinking, output_config.effort, no temperature on fixed-sampling
   models, and thinking omitted entirely where an explicit "disabled" would be
   rejected. structuredSchema is ignored until R5 wires withStructuredOutput. */
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatOpenAI } from "@langchain/openai";
import {
    ANTHROPIC_ALWAYS_THINKING_MODEL_IDS,
    ANTHROPIC_FIXED_SAMPLING_MODEL_IDS,
    ModelProvider,
    ModelTransport,
    ThinkingMode,
} from "../../consts";
import type { ProviderUsage } from "../../types/tools";
import type { ModelBinding } from "../profile.ts";
import { chatContentToString } from "../provider.ts";
import type { ChatCallOptions, ChatProvider, ChatRetryListener } from "../provider.ts";
import { withLlmRetries } from "../retry.ts";

type AnthropicFields = NonNullable<ConstructorParameters<typeof ChatAnthropic>[0]>;
type OpenAiFields = NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>;
type DeepSeekFields = NonNullable<ConstructorParameters<typeof ChatDeepSeek>[0]>;

export type DirectChatModel = ChatAnthropic | ChatOpenAI | ChatDeepSeek;

const matchesModelId = (model: string, ids: readonly string[]): boolean => ids.some((id) => model.startsWith(id));

const buildAnthropicModel = (binding: ModelBinding, options: ChatCallOptions): ChatAnthropic => {
    /* Fable 5 rejects an explicit thinking:"disabled"; drop it so the request
       carries no thinking field at all for always-thinking models. */
    const thinking =
        options.thinking === ThinkingMode.DISABLED && matchesModelId(binding.model, ANTHROPIC_ALWAYS_THINKING_MODEL_IDS)
            ? undefined
            : options.thinking;
    const thinkingActive = thinking !== undefined && thinking !== ThinkingMode.DISABLED;
    const fields: AnthropicFields = {
        model: binding.model,
        /* Our retry layer owns transient failures; the AsyncCaller default of 6
           internal retries would multiply with it. Same for the other providers. */
        maxRetries: 0,
    };
    if (options.maxTokens !== undefined) {
        fields.maxTokens = options.maxTokens;
    }
    /* The API rejects temperature both on fixed-sampling models and alongside
       active thinking (the SDK validates the latter); drop it like the gateway
       used to rather than failing the call. */
    if (
        options.temperature !== undefined &&
        !thinkingActive &&
        !matchesModelId(binding.model, ANTHROPIC_FIXED_SAMPLING_MODEL_IDS)
    ) {
        fields.temperature = options.temperature;
    }
    if (thinking !== undefined) {
        /* "enabled" passes through for gateway parity; current profiles bind
           adaptive, and an invalid combo fails fast as a non-retryable 400. */
        fields.thinking = { type: thinking } as NonNullable<AnthropicFields["thinking"]>;
    } else {
        /* The class defaults thinking to {type:"disabled"} and always puts it in
           the body; invocationKwargs wins at the wire and undefined values are
           dropped from the JSON, so this suppresses the field entirely. */
        fields.invocationKwargs = { thinking: undefined };
    }
    if (thinkingActive && options.reasoningEffort !== undefined) {
        fields.outputConfig = { effort: options.reasoningEffort };
    }
    return new ChatAnthropic(fields);
};

const buildOpenAiModel = (binding: ModelBinding, options: ChatCallOptions): ChatOpenAI => {
    /* OpenAI has no thinking request param — reasoning effort is the only
       reasoning control, so options.thinking is intentionally ignored here. */
    const fields: OpenAiFields = { model: binding.model, maxRetries: 0 };
    if (options.temperature !== undefined) {
        fields.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
        fields.maxTokens = options.maxTokens;
    }
    if (options.reasoningEffort !== undefined) {
        /* The SDK union lags the API's effort ladder (no "max"); the API owns
           validation, so pass the profile value through. */
        fields.reasoning = { effort: options.reasoningEffort } as NonNullable<OpenAiFields["reasoning"]>;
    }
    if (options.responseFormat !== undefined) {
        fields.modelKwargs = { response_format: { type: options.responseFormat } };
    }
    return new ChatOpenAI(fields);
};

const buildDeepSeekModel = (binding: ModelBinding, options: ChatCallOptions): ChatDeepSeek => {
    /* Mirror the gateway's non-Anthropic mapping: reasoning_effort plus a
       thinking body param with adaptive coerced to enabled. */
    const modelKwargs: Record<string, unknown> = {};
    if (options.responseFormat !== undefined) {
        modelKwargs.response_format = { type: options.responseFormat };
    }
    if (options.reasoningEffort !== undefined) {
        modelKwargs.reasoning_effort = options.reasoningEffort;
    }
    if (options.thinking !== undefined) {
        modelKwargs.thinking = {
            type: options.thinking === ThinkingMode.ADAPTIVE ? ThinkingMode.ENABLED : options.thinking,
        };
    }
    const fields: DeepSeekFields = { model: binding.model, maxRetries: 0 };
    if (options.temperature !== undefined) {
        fields.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
        fields.maxTokens = options.maxTokens;
    }
    if (Object.keys(modelKwargs).length > 0) {
        fields.modelKwargs = modelKwargs;
    }
    return new ChatDeepSeek(fields);
};

export const buildDirectChatModel = (binding: ModelBinding, options: ChatCallOptions): DirectChatModel => {
    switch (binding.provider) {
        case ModelProvider.ANTHROPIC:
            return buildAnthropicModel(binding, options);
        case ModelProvider.OPENAI:
            return buildOpenAiModel(binding, options);
        case ModelProvider.DEEPSEEK:
            return buildDeepSeekModel(binding, options);
    }
};

export const buildDirectMessages = (
    binding: ModelBinding,
    system: string,
    user: string,
    options: ChatCallOptions,
): [SystemMessage, HumanMessage] => {
    /* ChatAnthropic forwards SystemMessage content verbatim, so a text block
       with cache_control becomes a native prompt-cache breakpoint. Other
       providers cache implicitly and would reject the block shape. */
    if (options.cacheSystemPrompt && binding.provider === ModelProvider.ANTHROPIC) {
        const blocks = [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }];
        return [new SystemMessage({ content: blocks }), new HumanMessage(user)];
    }
    return [new SystemMessage(system), new HumanMessage(user)];
};

type DirectMessageLike = {
    response_metadata?: Record<string, unknown> | undefined;
    usage_metadata?: UsageMetadata | undefined;
};

export const extractDirectUsage = (message: DirectMessageLike): ProviderUsage => {
    /* response_metadata.usage is the raw SDK usage object (Anthropic cache
       fields, DeepSeek prompt_cache_hit/miss) — exactly what calculateUsage
       normalizes. OpenAI-family responses attach it only when the response
       carries a system_fingerprint, hence the usage_metadata fallback. */
    const raw = message.response_metadata?.usage;
    if (raw && typeof raw === "object") {
        return raw as ProviderUsage;
    }
    const metadata = message.usage_metadata;
    if (!metadata) {
        return {};
    }
    /* Lossy fallback: cache writes are not distinguishable here, so cache reads
       map to the OpenAI cached_tokens path of the cost normalizer. */
    return {
        prompt_tokens: metadata.input_tokens,
        completion_tokens: metadata.output_tokens,
        total_tokens: metadata.total_tokens,
        ...(metadata.input_token_details?.cache_read !== undefined
            ? { prompt_tokens_details: { cached_tokens: metadata.input_token_details.cache_read } }
            : {}),
    };
};

export type DirectProviderHooks = {
    onRetry?: ChatRetryListener;
};

export const createDirectChatProvider = (hooks: DirectProviderHooks = {}): ChatProvider => ({
    kind: ModelTransport.DIRECT,
    call: async (role, binding, system, user, options = {}) => {
        const model = buildDirectChatModel(binding, options);
        const messages = buildDirectMessages(binding, system, user, options);
        const response = await withLlmRetries(() => model.invoke(messages), {
            maxRetries: options.maxRetries,
            onRetry: hooks.onRetry
                ? (info) => hooks.onRetry?.(info, { role, model: binding.model, transport: ModelTransport.DIRECT })
                : undefined,
        });

        const text = chatContentToString(response.content);
        if (!text) {
            throw new Error(`Direct provider returned an empty assistant message for ${role} (${binding.model}).`);
        }

        return { text, usage: extractDirectUsage(response), pricingKey: binding.model };
    },
});
