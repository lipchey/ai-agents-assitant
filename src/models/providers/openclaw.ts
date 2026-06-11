/* Legacy OpenClaw gateway adapter. Request construction is extracted verbatim
   from the pre-R3 src/tools/llm.ts so transport:"openclaw" bindings stay
   byte-identical. The gateway HTTP client lives in L4 tools/, above this L2
   subsystem, so the transport functions are injected by the callLlm shim. */
import {
    CHAT_COMPLETIONS_TIMEOUT_S,
    ChatRole,
    DEFAULT_OPENCLAW_MODEL,
    ModelProvider,
    ModelTransport,
    OpenClawControl,
    STRONG_REASONING_AGENT_ID,
    ThinkingMode,
} from "../../consts";
import type { ModelRole } from "../../consts";
import type { ChatCompletionResponse, JsonObject } from "../../types/tools";
import type { ModelBinding } from "../profile.ts";
import { chatContentToString } from "../provider.ts";
import type { ChatCallOptions, ChatProvider, ChatRetryListener } from "../provider.ts";
import { withLlmRetries } from "../retry.ts";

export type OpenClawChatRequest = {
    endpoint: string;
    body: JsonObject;
    headers: Record<string, string>;
    timeoutS: number;
};

export const buildOpenClawChatRequest = (
    role: ModelRole,
    binding: ModelBinding,
    system: string,
    user: string,
    options: ChatCallOptions,
): OpenClawChatRequest => {
    const { provider, model: modelRef } = binding;
    /* Adaptive Anthropic thinking requires the strong-reasoning OpenClaw agent. */
    const agentId =
        provider === ModelProvider.ANTHROPIC && options.thinking === ThinkingMode.ADAPTIVE
            ? STRONG_REASONING_AGENT_ID
            : undefined;
    const body: JsonObject = {
        model: agentId ? `openclaw/${agentId}` : DEFAULT_OPENCLAW_MODEL,
        messages: [
            { role: ChatRole.SYSTEM, content: system },
            { role: ChatRole.USER, content: user },
        ],
        stream: false,
        user: `ai-agents-assitant:${role}`,
    };

    if (options.temperature !== undefined) {
        body.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
        body.max_tokens = options.maxTokens;
    }
    if (options.responseFormat !== undefined) {
        body.response_format = { type: options.responseFormat };
    }

    if (provider === ModelProvider.ANTHROPIC) {
        /* Anthropic uses thinking + output_config.effort, not reasoning_effort. */
        if (options.thinking !== undefined) {
            body.thinking = { type: options.thinking };
        }
        if (
            options.thinking !== undefined &&
            options.thinking !== ThinkingMode.DISABLED &&
            options.reasoningEffort !== undefined
        ) {
            body.output_config = { effort: options.reasoningEffort };
        }
    } else {
        if (options.reasoningEffort !== undefined) {
            body.reasoning_effort = options.reasoningEffort;
        }
        if (options.thinking !== undefined) {
            body.thinking = {
                type: options.thinking === ThinkingMode.ADAPTIVE ? ThinkingMode.ENABLED : options.thinking,
            };
        }
    }

    const headers: Record<string, string> = { "x-openclaw-model": modelRef };
    if (agentId) {
        headers["x-openclaw-agent-id"] = agentId;
    }

    return {
        endpoint: OpenClawControl.CHAT_COMPLETIONS_ENDPOINT,
        body,
        headers,
        timeoutS: CHAT_COMPLETIONS_TIMEOUT_S,
    };
};

export type OpenClawTransport = {
    post: <T>(
        endpoint: string,
        body: JsonObject,
        options?: { timeoutS?: number; headers?: Record<string, string> },
    ) => Promise<T>;
    /* Empty-response failures keep the caller-visible OpenClawError identity. */
    createError: (message: string) => Error;
    onRetry?: ChatRetryListener;
};

export const createOpenClawChatProvider = (transport: OpenClawTransport): ChatProvider => ({
    kind: ModelTransport.OPENCLAW,
    call: async (role, binding, system, user, options = {}) => {
        const request = buildOpenClawChatRequest(role, binding, system, user, options);
        const response = await withLlmRetries(
            () =>
                transport.post<ChatCompletionResponse>(request.endpoint, request.body, {
                    timeoutS: request.timeoutS,
                    headers: request.headers,
                }),
            {
                maxRetries: options.maxRetries,
                onRetry: transport.onRetry
                    ? (info) =>
                          transport.onRetry?.(info, {
                              role,
                              model: binding.model,
                              transport: ModelTransport.OPENCLAW,
                          })
                    : undefined,
            },
        );

        const text = chatContentToString(response.choices?.[0]?.message?.content);
        if (!text) {
            throw transport.createError(`OpenClaw returned an empty assistant message for ${role} (${binding.model}).`);
        }

        return { text, usage: response.usage ?? {}, pricingKey: binding.model };
    },
});
