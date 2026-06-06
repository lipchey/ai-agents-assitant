import { ChatRole, DEFAULT_OPENCLAW_MODEL, ModelProvider, OpenClawControl, STRONG_REASONING_AGENT_ID, ThinkingMode } from "../consts";
import { OpenClawError } from "./errors.ts";
import { jsonPost } from "./http.ts";
import { modelForRole } from "./models.ts";
import { calculateUsage, loadPricing } from "./pricing.ts";
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
): Promise<LlmCallResult> => {
    const { modelRef, provider, temperature } = modelForRole(role);
    /* Adaptive Anthropic thinking requires the strong-reasoning OpenClaw agent. */
    const agentId = provider === ModelProvider.ANTHROPIC && options.thinking === ThinkingMode.ADAPTIVE
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

    if (temperature !== undefined) {
        body.temperature = temperature;
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
        if (options.thinking !== undefined && options.thinking !== ThinkingMode.DISABLED && options.reasoningEffort !== undefined) {
            body.output_config = { effort: options.reasoningEffort };
        }
    } else {
        if (options.reasoningEffort !== undefined) {
            body.reasoning_effort = options.reasoningEffort;
        }
        if (options.thinking !== undefined) {
            body.thinking = { type: options.thinking === ThinkingMode.ADAPTIVE ? ThinkingMode.ENABLED : options.thinking };
        }
    }

    const headers: Record<string, string> = { "x-openclaw-model": modelRef };
    if (agentId) {
        headers["x-openclaw-agent-id"] = agentId;
    }

    const response = await jsonPost<ChatCompletionResponse>(OpenClawControl.CHAT_COMPLETIONS_ENDPOINT, body, { timeoutS: 180, headers });

    const content = contentToString(response.choices?.[0]?.message?.content);
    if (!content) {
        throw new OpenClawError(`OpenClaw returned an empty assistant message for ${role} (${modelRef}).`);
    }

    const pricing = (await loadPricing())[modelRef];
    return { content, ...calculateUsage(response.usage ?? {}, pricing) };
};
