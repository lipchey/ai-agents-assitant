import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
    ChatRole,
    DEFAULT_OPENCLAW_MODEL,
    ModelProvider,
    OpenClawControl,
    STRONG_REASONING_AGENT_ID,
    ThinkingMode,
} from "../consts";
import { readProfile, resolveBinding } from "../models";
import { OpenClawError } from "./errors.ts";
import { jsonPost } from "./http.ts";
import { calculateUsage, loadPricing } from "./pricing.ts";
import type { ModelParams } from "../models";
import type { ModelRole } from "../consts";
import type { ChatCompletionResponse, LlmCallOptions, LlmCallResult } from "../types/tools";
import type { JsonObject } from "../types/tools";

export type { LlmCallOptions, LlmCallResult } from "../types/tools";

const contentToString = (content: unknown): string => {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") {
                    return part;
                }
                if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
                    return part.text;
                }
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    return content === null || content === undefined ? "" : String(content);
};

export const callLlm = async (
    role: ModelRole,
    system: string,
    user: string,
    options: LlmCallOptions = {},
    config?: LangGraphRunnableConfig,
): Promise<LlmCallResult> => {
    const binding = resolveBinding(role, readProfile(config));
    const { provider, model: modelRef } = binding;
    /* binding.params carries the role/model-tied tuning (temperature, thinking,
       effort); per-call options (maxTokens, responseFormat) override per request. */
    const merged: ModelParams = { ...binding.params, ...options };
    /* Adaptive Anthropic thinking requires the strong-reasoning OpenClaw agent. */
    const agentId =
        provider === ModelProvider.ANTHROPIC && merged.thinking === ThinkingMode.ADAPTIVE
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

    if (merged.temperature !== undefined) {
        body.temperature = merged.temperature;
    }
    if (merged.maxTokens !== undefined) {
        body.max_tokens = merged.maxTokens;
    }
    if (merged.responseFormat !== undefined) {
        body.response_format = { type: merged.responseFormat };
    }

    if (provider === ModelProvider.ANTHROPIC) {
        /* Anthropic uses thinking + output_config.effort, not reasoning_effort. */
        if (merged.thinking !== undefined) {
            body.thinking = { type: merged.thinking };
        }
        if (
            merged.thinking !== undefined &&
            merged.thinking !== ThinkingMode.DISABLED &&
            merged.reasoningEffort !== undefined
        ) {
            body.output_config = { effort: merged.reasoningEffort };
        }
    } else {
        if (merged.reasoningEffort !== undefined) {
            body.reasoning_effort = merged.reasoningEffort;
        }
        if (merged.thinking !== undefined) {
            body.thinking = {
                type: merged.thinking === ThinkingMode.ADAPTIVE ? ThinkingMode.ENABLED : merged.thinking,
            };
        }
    }

    const headers: Record<string, string> = { "x-openclaw-model": modelRef };
    if (agentId) {
        headers["x-openclaw-agent-id"] = agentId;
    }

    const response = await jsonPost<ChatCompletionResponse>(OpenClawControl.CHAT_COMPLETIONS_ENDPOINT, body, {
        timeoutS: 180,
        headers,
    });

    const content = contentToString(response.choices?.[0]?.message?.content);
    if (!content) {
        throw new OpenClawError(`OpenClaw returned an empty assistant message for ${role} (${modelRef}).`);
    }

    const pricing = (await loadPricing())[modelRef];
    return { content, ...calculateUsage(response.usage ?? {}, pricing) };
};
