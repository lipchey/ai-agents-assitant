/*
 * Provider seam tests (src/models/providers/*). No network:
 * - openclaw: buildOpenClawChatRequest must mirror the pre-R3 request body
 *   byte-for-byte (the gateway path is behavior-pinned by default.json5);
 * - the provider wrapper: retry + empty-message handling over a stubbed post;
 * - direct: option-mapping asserted through the model classes'
 *   invocationParams() — request construction only, no API calls.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatOpenAI } from "@langchain/openai";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ModelRole, OpenClawControl } from "../../src/consts";
import { buildDirectChatModel, buildDirectMessages, extractDirectUsage } from "../../src/models/providers/direct.ts";
import { buildOpenClawChatRequest, createOpenClawChatProvider } from "../../src/models/providers/openclaw.ts";
import type { ModelBinding } from "../../src/models";

const opusBinding: ModelBinding = {
    provider: "anthropic",
    model: "anthropic/claude-opus-4-8",
    params: { thinking: "adaptive", reasoningEffort: "high" },
};

const flashBinding: ModelBinding = {
    provider: "deepseek",
    model: "deepseek/deepseek-v4-flash",
    params: { temperature: 0, thinking: "disabled" },
};

const gptBinding: ModelBinding = {
    provider: "openai",
    model: "openai/gpt-5.5",
    params: { temperature: 0.1 },
};

describe("buildOpenClawChatRequest", () => {
    it("routes Anthropic adaptive thinking through the strong-reasoning agent", () => {
        const request = buildOpenClawChatRequest(ModelRole.ARCHITECT, opusBinding, "sys", "usr", {
            ...opusBinding.params,
            maxTokens: 2_000,
        });

        expect(request.endpoint).toBe(OpenClawControl.CHAT_COMPLETIONS_ENDPOINT);
        expect(request.headers).toEqual({
            "x-openclaw-model": "anthropic/claude-opus-4-8",
            "x-openclaw-agent-id": "strong-reasoning",
        });
        expect(request.body).toEqual({
            model: "openclaw/strong-reasoning",
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "usr" },
            ],
            stream: false,
            user: "ai-agents-assitant:architect",
            max_tokens: 2_000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
        });
    });

    it("keeps disabled thinking without output_config for Anthropic", () => {
        const request = buildOpenClawChatRequest(ModelRole.SME, opusBinding, "sys", "usr", {
            thinking: "disabled",
            reasoningEffort: "high",
        });

        expect(request.headers).toEqual({ "x-openclaw-model": "anthropic/claude-opus-4-8" });
        expect(request.body.model).toBe("openclaw/default");
        expect(request.body.thinking).toEqual({ type: "disabled" });
        expect(request.body).not.toHaveProperty("output_config");
    });

    it("maps the DeepSeek planner call exactly as the pre-refactor body", () => {
        const request = buildOpenClawChatRequest(ModelRole.ROUTER, flashBinding, "sys", "usr", {
            ...flashBinding.params,
            maxTokens: 160,
            responseFormat: "json_object",
        });

        expect(request.headers).toEqual({ "x-openclaw-model": "deepseek/deepseek-v4-flash" });
        expect(request.body).toEqual({
            model: "openclaw/default",
            messages: [
                { role: "system", content: "sys" },
                { role: "user", content: "usr" },
            ],
            stream: false,
            user: "ai-agents-assitant:router",
            temperature: 0,
            max_tokens: 160,
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
        });
    });

    it("maps non-Anthropic adaptive thinking to enabled and keeps reasoning_effort", () => {
        const request = buildOpenClawChatRequest(ModelRole.FRONTIER, flashBinding, "sys", "usr", {
            thinking: "adaptive",
            reasoningEffort: "high",
        });

        expect(request.body.thinking).toEqual({ type: "enabled" });
        expect(request.body.reasoning_effort).toBe("high");
    });

    it("sends plain temperature-only calls without thinking or effort fields", () => {
        const request = buildOpenClawChatRequest(ModelRole.CRITIC, gptBinding, "sys", "usr", {
            ...gptBinding.params,
            maxTokens: 1_400,
            responseFormat: "json_object",
        });

        expect(request.body.temperature).toBe(0.1);
        expect(request.body).not.toHaveProperty("thinking");
        expect(request.body).not.toHaveProperty("reasoning_effort");
        expect(request.body).not.toHaveProperty("output_config");
    });
});

describe("createOpenClawChatProvider", () => {
    const response = {
        choices: [{ message: { content: "answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    it("posts the built request and returns text, raw usage, and the pricing key", async () => {
        const post = vi.fn().mockResolvedValue(response);
        const provider = createOpenClawChatProvider({ post, createError: (message) => new Error(message) });

        const result = await provider.call(ModelRole.ROUTER, flashBinding, "sys", "usr", { ...flashBinding.params });

        expect(post).toHaveBeenCalledWith(
            OpenClawControl.CHAT_COMPLETIONS_ENDPOINT,
            expect.objectContaining({ model: "openclaw/default" }),
            expect.objectContaining({ timeoutS: 180, headers: { "x-openclaw-model": "deepseek/deepseek-v4-flash" } }),
        );
        expect(result.text).toBe("answer");
        expect(result.usage).toEqual(response.usage);
        expect(result.pricingKey).toBe("deepseek/deepseek-v4-flash");
    });

    it("retries transient gateway failures before succeeding", async () => {
        const post = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error("OpenClaw HTTP 503"), { status: 503 }))
            .mockResolvedValue(response);
        const onRetry = vi.fn();
        const provider = createOpenClawChatProvider({ post, createError: (message) => new Error(message), onRetry });

        /* maxRetries=1 keeps the test fast; the real budget comes from tuning. */
        const result = await provider.call(ModelRole.ROUTER, flashBinding, "sys", "usr", { maxRetries: 1 });

        expect(result.text).toBe("answer");
        expect(post).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(
            expect.objectContaining({ attempt: 1 }),
            expect.objectContaining({ role: "router", model: "deepseek/deepseek-v4-flash", transport: "openclaw" }),
        );
    });

    it("throws through the injected error factory on an empty assistant message", async () => {
        const post = vi.fn().mockResolvedValue({ choices: [{ message: { content: "" } }] });
        const provider = createOpenClawChatProvider({
            post,
            createError: (message) => new Error(`custom: ${message}`),
        });

        await expect(provider.call(ModelRole.ROUTER, flashBinding, "sys", "usr", {})).rejects.toThrow(
            "custom: OpenClaw returned an empty assistant message for router (deepseek/deepseek-v4-flash).",
        );
    });
});

describe("buildDirectChatModel", () => {
    beforeAll(() => {
        /* ChatAnthropic/ChatDeepSeek throw at construction without a key; the
           tests never leave invocationParams(), so dummies are safe. */
        process.env.ANTHROPIC_API_KEY ??= "test-key";
        process.env.OPENAI_API_KEY ??= "test-key";
        process.env.DEEPSEEK_API_KEY ??= "test-key";
    });

    const fableBinding: ModelBinding = { provider: "anthropic", model: "claude-fable-5" };
    const haikuBinding: ModelBinding = { provider: "anthropic", model: "claude-haiku-4-5" };
    const gptDirectBinding: ModelBinding = { provider: "openai", model: "gpt-5.5" };
    const flashDirectBinding: ModelBinding = { provider: "deepseek", model: "deepseek-v4-flash" };

    it("maps Anthropic adaptive thinking with output_config effort and no temperature", () => {
        const model = buildDirectChatModel(fableBinding, {
            thinking: "adaptive",
            reasoningEffort: "high",
            temperature: 0.3,
            maxTokens: 2_400,
        });

        expect(model).toBeInstanceOf(ChatAnthropic);
        const params = (model as ChatAnthropic).invocationParams();
        expect(params.model).toBe("claude-fable-5");
        expect(params.max_tokens).toBe(2_400);
        expect(params.thinking).toEqual({ type: "adaptive" });
        expect(params.output_config).toEqual({ effort: "high" });
        expect(params.temperature).toBeUndefined();
    });

    it("omits the thinking request field entirely on Fable 5 with thinking disabled", () => {
        const params = (
            buildDirectChatModel(fableBinding, { thinking: "disabled" }) as ChatAnthropic
        ).invocationParams();

        /* invocationKwargs override: the key may exist but must serialize away. */
        expect(params.thinking).toBeUndefined();
        expect(params.output_config).toBeUndefined();
        expect(JSON.parse(JSON.stringify(params))).not.toHaveProperty("thinking");
    });

    it("suppresses the library default thinking when the binding sets none", () => {
        const params = (buildDirectChatModel(haikuBinding, { temperature: 0 }) as ChatAnthropic).invocationParams();

        expect(params.temperature).toBe(0);
        expect(JSON.parse(JSON.stringify(params))).not.toHaveProperty("thinking");
    });

    it("keeps explicit disabled thinking for Anthropic models that accept it", () => {
        const params = (
            buildDirectChatModel(haikuBinding, { thinking: "disabled", temperature: 0 }) as ChatAnthropic
        ).invocationParams();

        expect(params.thinking).toEqual({ type: "disabled" });
        expect(params.temperature).toBe(0);
    });

    it("drops temperature on fixed-sampling Anthropic models even without thinking", () => {
        const params = (buildDirectChatModel(fableBinding, { temperature: 0.7 }) as ChatAnthropic).invocationParams();

        expect(params.temperature).toBeUndefined();
    });

    it("maps OpenAI options to reasoning_effort, response_format, and completion tokens", () => {
        const model = buildDirectChatModel(gptDirectBinding, {
            temperature: 0.1,
            maxTokens: 1_400,
            reasoningEffort: "high",
            responseFormat: "json_object",
        });

        expect(model).toBeInstanceOf(ChatOpenAI);
        const params = (model as ChatOpenAI).invocationParams() as Record<string, unknown>;
        expect(params.model).toBe("gpt-5.5");
        expect(params.temperature).toBe(0.1);
        expect(params.reasoning_effort).toBe("high");
        expect(params.response_format).toEqual({ type: "json_object" });
        /* gpt-5.5 is a reasoning model for the SDK: tokens land in max_completion_tokens. */
        expect(params.max_completion_tokens).toBe(1_400);
    });

    it("maps DeepSeek options through modelKwargs with adaptive coerced to enabled", () => {
        const model = buildDirectChatModel(flashDirectBinding, {
            temperature: 0,
            maxTokens: 160,
            thinking: "adaptive",
            reasoningEffort: "high",
            responseFormat: "json_object",
        });

        expect(model).toBeInstanceOf(ChatDeepSeek);
        const params = (model as ChatDeepSeek).invocationParams() as Record<string, unknown>;
        expect(params.model).toBe("deepseek-v4-flash");
        expect(params.temperature).toBe(0);
        expect(params.max_tokens).toBe(160);
        expect(params.thinking).toEqual({ type: "enabled" });
        expect(params.reasoning_effort).toBe("high");
        expect(params.response_format).toEqual({ type: "json_object" });
    });

    it("keeps explicit disabled thinking for DeepSeek", () => {
        const params = (
            buildDirectChatModel(flashDirectBinding, { thinking: "disabled" }) as ChatDeepSeek
        ).invocationParams() as Record<string, unknown>;

        expect(params.thinking).toEqual({ type: "disabled" });
    });
});

describe("buildDirectMessages", () => {
    const fableBinding: ModelBinding = { provider: "anthropic", model: "claude-fable-5" };
    const gptDirectBinding: ModelBinding = { provider: "openai", model: "gpt-5.5" };

    it("adds an Anthropic cache_control breakpoint when cacheSystemPrompt is set", () => {
        const [system, user] = buildDirectMessages(fableBinding, "sys", "usr", { cacheSystemPrompt: true });

        expect(system.content).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
        expect(user.content).toBe("usr");
    });

    it("keeps a plain string system prompt otherwise", () => {
        expect(buildDirectMessages(fableBinding, "sys", "usr", {})[0].content).toBe("sys");
        expect(buildDirectMessages(gptDirectBinding, "sys", "usr", { cacheSystemPrompt: true })[0].content).toBe("sys");
    });
});

describe("extractDirectUsage", () => {
    it("prefers the raw provider usage from response_metadata", () => {
        const usage = {
            input_tokens: 800,
            output_tokens: 300,
            cache_read_input_tokens: 1200,
            cache_creation: { ephemeral_5m_input_tokens: 500 },
        };

        expect(extractDirectUsage({ response_metadata: { usage } })).toEqual(usage);
    });

    it("falls back to usage_metadata when raw usage is absent", () => {
        const extracted = extractDirectUsage({
            response_metadata: {},
            usage_metadata: {
                input_tokens: 2000,
                output_tokens: 600,
                total_tokens: 2600,
                input_token_details: { cache_read: 1500 },
            },
        });

        expect(extracted).toEqual({
            prompt_tokens: 2000,
            completion_tokens: 600,
            total_tokens: 2600,
            prompt_tokens_details: { cached_tokens: 1500 },
        });
    });

    it("returns empty usage when neither source is present", () => {
        expect(extractDirectUsage({ response_metadata: {} })).toEqual({});
    });
});
