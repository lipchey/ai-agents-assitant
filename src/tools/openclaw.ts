import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";
const DEFAULT_GATEWAY_TOKEN = "dev_token_123";
const DEFAULT_TIMEOUT_S = 30;
const STARTUP_TIMEOUT_MS = 45_000;

type JsonObject = Record<string, unknown>;

type ModelRole =
    | "architect"
    | "coder"
    | "critic"
    | "firewall"
    | "frontier"
    | "router"
    | "sme"
    | "worker";

type ModelProvider = "anthropic" | "deepseek" | "openai" | "unknown";

type ModelRouting = {
    modelRef: string;
    provider: ModelProvider;
    temperature?: number;
};

type ModelPricing = {
    inputPer1M: number;
    outputPer1M: number;
    inputCacheHitPer1M?: number;
    inputCacheMissPer1M?: number;
    inputCacheWritePer1M?: number;
    inputCacheWrite5mPer1M?: number;
    inputCacheWrite1hPer1M?: number;
};

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: unknown;
        };
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        uncached_input_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
        prompt_tokens_details?: {
            cached_tokens?: number;
        };
        input_tokens_details?: {
            cached_tokens?: number;
        };
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_creation?: {
            ephemeral_5m_input_tokens?: number;
            ephemeral_1h_input_tokens?: number;
        };
    };
};

export type LlmCallResult = {
    content: string;
    tokens: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheMissInputTokens: number;
    cacheWriteInputTokens: number;
};

export type LlmCallOptions = {
    maxTokens?: number;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
    responseFormat?: "json_object";
    thinking?: "adaptive" | "enabled" | "disabled";
};

export type OpenClawRpcArgs = JsonObject & {
    command?: string;
    path?: string;
    pattern?: string;
    query?: string;
    subtask?: string;
    workdir?: string;
    requireConfirmation?: boolean;
    timeout?: number;
};

export type OpenClawRpcOptions = {
    timeoutS?: number;
    idempotencyKey?: string;
    maxRetries?: number;
    sessionKey?: string;
    action?: string;
};

export class OpenClawError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "OpenClawError";
    }
}

let managedGatewayProcess: ChildProcess | null = null;
let managedGatewayLog = "";
let pricingCache: Promise<Record<string, ModelPricing>> | undefined;

const STRONG_REASONING_AGENT_ID = "strong-reasoning";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const appendGatewayLog = (chunk: Buffer) => {
    managedGatewayLog = `${managedGatewayLog}${chunk.toString("utf8")}`.slice(-8_000);
};

const getGatewayBaseUrl = (): string => {
    const configured = process.env.OPENCLAW_GATEWAY_URL ?? process.env.OPENCLAW_BASE_URL ?? DEFAULT_GATEWAY_URL;
    return configured
        .replace(/^ws:/u, "http:")
        .replace(/^wss:/u, "https:")
        .replace(/\/+$/u, "");
};

const getGatewayToken = (): string => process.env.OPENCLAW_GATEWAY_TOKEN ?? DEFAULT_GATEWAY_TOKEN;

const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${getGatewayToken()}`,
});

const getOpenClawConfigPath = (): string => process.env.OPENCLAW_CONFIG_PATH ?? path.join(process.cwd(), "openclaw.config.json5");

const getOpenClawStateDir = (): string => process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".openclaw_state");

const probeGateway = async (timeoutMs = 2_000): Promise<boolean> => {
    const baseUrl = getGatewayBaseUrl();
    const probeUrls = [`${baseUrl}/readyz`, `${baseUrl}/healthz`, `${baseUrl}/v1/models`];

    for (const url of probeUrls) {
        try {
            const response = await fetch(url, {
                headers: authHeaders(),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok) {
                return true;
            }
        } catch {
            // Try the next probe endpoint before declaring the gateway unavailable.
        }
    }

    return false;
};

const resolveGatewayPort = (): string => {
    const baseUrl = getGatewayBaseUrl();
    const parsed = new URL(baseUrl);
    if (parsed.port) {
        return parsed.port;
    }
    return parsed.protocol === "https:" ? "443" : "80";
};

const resolveOpenClawCli = async (): Promise<{ command: string; argsPrefix: string[] }> => {
    const localCli = path.join(process.cwd(), "node_modules", "openclaw", "openclaw.mjs");
    try {
        await fs.access(localCli);
        return { command: process.execPath, argsPrefix: [localCli] };
    } catch {
        return { command: "openclaw", argsPrefix: [] };
    }
};

export const startOpenClawGateway = async (): Promise<void> => {
    if (await probeGateway()) {
        return;
    }

    if (managedGatewayProcess) {
        return;
    }

    const { command, argsPrefix } = await resolveOpenClawCli();
    const args = [
        ...argsPrefix,
        "gateway",
        "run",
        "--allow-unconfigured",
        "--port",
        resolveGatewayPort(),
        "--bind",
        "loopback",
        "--auth",
        "token",
    ];

    managedGatewayLog = "";
    const child = spawn(command, args, {
        env: {
            ...process.env,
            OPENCLAW_CONFIG_PATH: getOpenClawConfigPath(),
            OPENCLAW_GATEWAY_TOKEN: getGatewayToken(),
            OPENCLAW_STATE_DIR: getOpenClawStateDir(),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    managedGatewayProcess = child;
    child.stdout?.on("data", appendGatewayLog);
    child.stderr?.on("data", appendGatewayLog);
    child.once("error", (error) => {
        if (managedGatewayProcess === child) {
            managedGatewayLog = `${managedGatewayLog}\n[openclaw spawn error: ${error.message}]`;
            managedGatewayProcess = null;
        }
    });
    child.once("exit", (code, signal) => {
        if (managedGatewayProcess === child) {
            managedGatewayLog = `${managedGatewayLog}\n[openclaw exited code=${code ?? "null"} signal=${signal ?? "null"}]`;
            managedGatewayProcess = null;
        }
    });

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await probeGateway()) {
            return;
        }
        if (!managedGatewayProcess) {
            break;
        }
        await sleep(750);
    }

    const logSuffix = managedGatewayLog.trim() ? `\n\nOpenClaw output:\n${managedGatewayLog.trim()}` : "";
    throw new OpenClawError(`OpenClaw Gateway did not become ready at ${getGatewayBaseUrl()}.${logSuffix}`);
};

export const stopOpenClawGateway = async (): Promise<void> => {
    const child = managedGatewayProcess;
    if (!child) {
        return;
    }

    managedGatewayProcess = null;
    let exited = false;
    const exitedPromise = new Promise<void>((resolve) => {
        child.once("exit", () => {
            exited = true;
            resolve();
        });
    });
    child.kill("SIGTERM");

    await Promise.race([
        exitedPromise,
        sleep(5_000).then(() => {
            if (!exited) {
                child.kill("SIGKILL");
            }
        }),
    ]);
};

const loadPricing = (): Promise<Record<string, ModelPricing>> => {
    pricingCache ??= fs.readFile(path.join(process.cwd(), "src", "pricing.json"), "utf8")
        .then((pricingFile) => JSON.parse(pricingFile) as Record<string, ModelPricing>)
        .catch(() => ({}));
    return pricingCache;
};

const providerForModel = (modelRef: string): ModelProvider => {
    const provider = modelRef.split("/", 1)[0];
    return provider === "anthropic" || provider === "deepseek" || provider === "openai"
        ? provider
        : "unknown";
};

const isClaudeOpusModel = (modelRef: string): boolean => {
    return /^anthropic\/claude-opus-/u.test(modelRef);
};

const route = (modelRef: string, temperature?: number): ModelRouting => ({
    modelRef,
    provider: providerForModel(modelRef),
    ...(!isClaudeOpusModel(modelRef) && temperature !== undefined ? { temperature } : {}),
});

const modelForRole = (modelKey: string): ModelRouting => {
    const role = modelKey as ModelRole;
    switch (role) {
        case "architect":
        case "sme":
            return route("anthropic/claude-opus-4-8", 0.2);
        case "coder":
            return route("anthropic/claude-sonnet-4-6", 0.2);
        case "critic":
            return route("openai/gpt-5.5", 0.1);
        case "frontier":
            return route("deepseek/deepseek-v4-pro", 0.2);
        case "firewall":
        case "router":
        case "worker":
            // Swarm-layer execution planning (lead delegation + ReAct workers) is
            // deliberately cheap: tool selection is not deep reasoning, and the
            // loop may issue many calls, so it runs on the cheapest flash model
            // at temperature 0 for stable, repeatable tool decisions.
            return route("deepseek/deepseek-v4-flash", 0);
        default:
            return route("deepseek/deepseek-v4-flash", 0.2);
    }
};

const jsonPost = async <T>(
    endpoint: string,
    body: JsonObject,
    options?: {
        timeoutS?: number;
        headers?: Record<string, string>;
    },
): Promise<T> => {
    const response = await fetch(`${getGatewayBaseUrl()}${endpoint}`, {
        method: "POST",
        headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((options?.timeoutS ?? DEFAULT_TIMEOUT_S) * 1_000),
    });

    const responseText = await response.text();
    let payload: unknown = null;
    if (responseText) {
        try {
            payload = JSON.parse(responseText);
        } catch {
            payload = { message: responseText };
        }
    }

    if (!response.ok) {
        throw new OpenClawError(`OpenClaw HTTP ${response.status} ${response.statusText}: ${stringifyForError(payload)}`);
    }

    return payload as T;
};

const stringifyForError = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
        return value.message;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

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

const usageNumber = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
};

const tokenCost = (tokens: number, per1M: number): number => {
    return (tokens / 1_000_000) * per1M;
};

const calculateUsage = (
    usage: NonNullable<ChatCompletionResponse["usage"]>,
    pricing: ModelPricing | undefined,
): Omit<LlmCallResult, "content"> => {
    const deepSeekCacheHitTokens = usageNumber(usage.prompt_cache_hit_tokens);
    const deepSeekCacheMissTokens = usageNumber(usage.prompt_cache_miss_tokens);
    const openAiCachedInputTokens = usageNumber(usage.prompt_tokens_details?.cached_tokens)
        ?? usageNumber(usage.input_tokens_details?.cached_tokens);
    const anthropicCacheReadTokens = usageNumber(usage.cache_read_input_tokens);
    const anthropicCacheWrite5mTokens = usageNumber(usage.cache_creation?.ephemeral_5m_input_tokens) ?? 0;
    const anthropicCacheWrite1hTokens = usageNumber(usage.cache_creation?.ephemeral_1h_input_tokens) ?? 0;
    const anthropicDetailedWriteTokens = anthropicCacheWrite5mTokens + anthropicCacheWrite1hTokens;
    const anthropicFlatWriteTokens = usageNumber(usage.cache_creation_input_tokens) ?? 0;
    const anthropicCacheWriteTokens = anthropicDetailedWriteTokens || anthropicFlatWriteTokens;
    const hasAnthropicCacheUsage = anthropicCacheReadTokens !== undefined || anthropicCacheWriteTokens > 0;
    const rawPromptTokens = usageNumber(usage.prompt_tokens);
    const rawInputTokens = usageNumber(usage.input_tokens);
    const uncachedInputTokens = usageNumber(usage.uncached_input_tokens);
    const rawTotalTokens = usageNumber(usage.total_tokens);

    const promptTokens = rawPromptTokens
        ?? rawInputTokens
        ?? uncachedInputTokens
        ?? (deepSeekCacheHitTokens ?? 0) + (deepSeekCacheMissTokens ?? 0);
    const outputTokens = usageNumber(usage.completion_tokens) ?? usageNumber(usage.output_tokens) ?? 0;
    const cachedInputTokens = deepSeekCacheHitTokens ?? openAiCachedInputTokens ?? anthropicCacheReadTokens ?? 0;
    const cacheWriteInputTokens = hasAnthropicCacheUsage ? anthropicCacheWriteTokens : 0;
    const anthropicRawInputTokens = rawInputTokens ?? rawPromptTokens ?? promptTokens;
    const anthropicRawInputIncludesCacheRead = rawPromptTokens !== undefined
        || openAiCachedInputTokens !== undefined
        || (
            rawInputTokens !== undefined
            && rawTotalTokens !== undefined
            && rawTotalTokens <= rawInputTokens + outputTokens
        );
    const anthropicCacheMissInputTokens = uncachedInputTokens
        ?? (
            anthropicRawInputIncludesCacheRead
                ? Math.max(0, anthropicRawInputTokens - cachedInputTokens)
                : anthropicRawInputTokens
        );
    const cacheMissInputTokens = deepSeekCacheMissTokens
        ?? (hasAnthropicCacheUsage ? anthropicCacheMissInputTokens : Math.max(0, promptTokens - cachedInputTokens));
    const inputTokens = hasAnthropicCacheUsage
        ? cacheMissInputTokens + cachedInputTokens + cacheWriteInputTokens
        : promptTokens;
    const computedTotalTokens = inputTokens + outputTokens;
    const tokens = hasAnthropicCacheUsage
        ? Math.max(rawTotalTokens ?? 0, computedTotalTokens)
        : rawTotalTokens ?? computedTotalTokens;

    if (!pricing) {
        return {
            tokens,
            cost: 0,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            cacheMissInputTokens,
            cacheWriteInputTokens,
        };
    }

    let inputCost = 0;
    if (deepSeekCacheHitTokens !== undefined || deepSeekCacheMissTokens !== undefined) {
        const hitTokens = deepSeekCacheHitTokens ?? 0;
        const missTokens = deepSeekCacheMissTokens ?? Math.max(0, promptTokens - hitTokens);
        const unclassifiedTokens = Math.max(0, promptTokens - hitTokens - missTokens);
        inputCost = tokenCost(hitTokens, pricing.inputCacheHitPer1M ?? pricing.inputPer1M)
            + tokenCost(missTokens, pricing.inputCacheMissPer1M ?? pricing.inputPer1M)
            + tokenCost(unclassifiedTokens, pricing.inputPer1M);
    } else if (hasAnthropicCacheUsage) {
        const flatWriteRemainderTokens = Math.max(0, anthropicFlatWriteTokens - anthropicDetailedWriteTokens);
        inputCost = tokenCost(cacheMissInputTokens, pricing.inputPer1M)
            + tokenCost(cachedInputTokens, pricing.inputCacheHitPer1M ?? pricing.inputPer1M)
            + tokenCost(anthropicCacheWrite5mTokens, pricing.inputCacheWrite5mPer1M ?? pricing.inputCacheWritePer1M ?? pricing.inputPer1M)
            + tokenCost(anthropicCacheWrite1hTokens, pricing.inputCacheWrite1hPer1M ?? pricing.inputCacheWritePer1M ?? pricing.inputPer1M)
            + tokenCost(flatWriteRemainderTokens, pricing.inputCacheWritePer1M ?? pricing.inputCacheWrite5mPer1M ?? pricing.inputPer1M);
    } else if (cachedInputTokens > 0) {
        inputCost = tokenCost(cachedInputTokens, pricing.inputCacheHitPer1M ?? pricing.inputPer1M)
            + tokenCost(Math.max(0, promptTokens - cachedInputTokens), pricing.inputCacheMissPer1M ?? pricing.inputPer1M);
    } else {
        inputCost = tokenCost(promptTokens, pricing.inputPer1M);
    }

    return {
        tokens,
        cost: inputCost + tokenCost(outputTokens, pricing.outputPer1M),
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheMissInputTokens,
        cacheWriteInputTokens,
    };
};

export const callLlm = async (
    modelKey: string,
    system: string,
    user: string,
    options: LlmCallOptions = {},
): Promise<LlmCallResult> => {
    const { modelRef, provider, temperature } = modelForRole(modelKey);
    const agentId = provider === "anthropic" && options.thinking === "adaptive"
        ? STRONG_REASONING_AGENT_ID
        : undefined;
    const body: JsonObject = {
        model: agentId ? `openclaw/${agentId}` : "openclaw/default",
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        stream: false,
        user: `ai-agents-assitant:${modelKey}`,
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

    if (provider === "anthropic") {
        if (options.thinking !== undefined) {
            body.thinking = { type: options.thinking };
        }
        if (options.thinking !== undefined && options.thinking !== "disabled" && options.reasoningEffort !== undefined) {
            body.output_config = { effort: options.reasoningEffort };
        }
    } else {
        if (options.reasoningEffort !== undefined) {
            body.reasoning_effort = options.reasoningEffort;
        }
        if (options.thinking !== undefined) {
            const thinkingType = options.thinking === "adaptive" ? "enabled" : options.thinking;
            body.thinking = { type: thinkingType };
        }
    }

    const headers: Record<string, string> = {
        "x-openclaw-model": modelRef,
    };
    if (agentId) {
        headers["x-openclaw-agent-id"] = agentId;
    }

    const response = await jsonPost<ChatCompletionResponse>(
        "/v1/chat/completions",
        body,
        {
            timeoutS: 180,
            headers,
        },
    );

    const content = contentToString(response.choices?.[0]?.message?.content);
    if (!content) {
        throw new OpenClawError(`OpenClaw returned an empty assistant message for ${modelKey} (${modelRef}).`);
    }

    const pricing = (await loadPricing())[modelRef];
    const usage = calculateUsage(response.usage ?? {}, pricing);

    return { content, ...usage };
};

const readString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

const readNumber = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readIntegerInRange = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
};

// Single source of truth for the shell allowlist. Exported so the Swarm's
// ReAct workers can both advertise the allowed commands to the planner model and
// pre-validate a proposed command before paying for an `openclawRpc` round-trip.
// The local exec adapter below re-checks against this set, so it remains the
// authoritative guard regardless of caller behavior.
export const SAFE_DIRECT_EXEC_COMMANDS = new Set([
    "git status --short",
    "npm run build",
    "npm run test",
    "npm run typecheck",
    "npm test",
    "npx tsc --noEmit",
]);

const SAFE_COMMAND_SPECS: Record<string, { command: string; args: string[] }> = {
    "git status --short": { command: "git", args: ["status", "--short"] },
    "npm run build": { command: "npm", args: ["run", "build"] },
    "npm run test": { command: "npm", args: ["run", "test"] },
    "npm run typecheck": { command: "npm", args: ["run", "typecheck"] },
    "npm test": { command: "npm", args: ["test"] },
    "npx tsc --noEmit": { command: "npx", args: ["tsc", "--noEmit"] },
};

const assertSafeDirectExecCommand = (tool: string, command: string): void => {
    if (!SAFE_DIRECT_EXEC_COMMANDS.has(command)) {
        throw new OpenClawError(`${tool} rejected unsafe command. Use an allowlisted verification command or add a guarded approval flow.`);
    }
};

export const resolveWorkspacePath = (inputPath: string): string => {
    const workspaceRoot = process.cwd();
    const resolved = path.resolve(workspaceRoot, inputPath);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new OpenClawError(`Path escapes workspace: ${inputPath}`);
    }
    return resolved;
};

const truncateOutput = (value: string, maxChars: number): string => {
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
};

const limitLines = (value: string, limit: number): string => {
    return value.split(/\r?\n/u).slice(0, limit).join("\n");
};

const runLocalProcess = async (
    label: string,
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutS?: number; maxOutputChars?: number },
): Promise<JsonObject> => {
    const cwd = options?.cwd ? resolveWorkspacePath(options.cwd) : process.cwd();
    const timeoutMs = (options?.timeoutS ?? DEFAULT_TIMEOUT_S) * 1_000;
    const maxOutputChars = options?.maxOutputChars ?? 200_000;

    return await new Promise<JsonObject>((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let forceKillTimer: NodeJS.Timeout | undefined;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
            stdout = truncateOutput(`${stdout}${chunk.toString("utf8")}`, maxOutputChars);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr = truncateOutput(`${stderr}${chunk.toString("utf8")}`, maxOutputChars);
        });
        child.once("error", (error) => {
            clearTimeout(timer);
            if (forceKillTimer) {
                clearTimeout(forceKillTimer);
            }
            resolve({
                status: "failed",
                details: {
                    label,
                    command,
                    args,
                    cwd,
                    error: error.message,
                    stdout,
                    stderr,
                },
            });
        });
        child.once("exit", (exitCode, signal) => {
            clearTimeout(timer);
            if (forceKillTimer) {
                clearTimeout(forceKillTimer);
            }
            resolve({
                status: timedOut ? "timed_out" : signal ? "failed" : "completed",
                details: {
                    label,
                    command,
                    args,
                    cwd,
                    exitCode,
                    signal,
                    stdout,
                    stderr,
                },
            });
        });
    });
};

const runLocalSafeCommand = async (
    tool: string,
    commandText: string,
    args: OpenClawRpcArgs,
    options?: OpenClawRpcOptions,
): Promise<JsonObject> => {
    assertSafeDirectExecCommand(tool, commandText);
    const spec = SAFE_COMMAND_SPECS[commandText];
    if (!spec) {
        throw new OpenClawError(`${tool} has no local command spec for ${commandText}.`);
    }
    return await runLocalProcess(tool, spec.command, spec.args, {
        cwd: readString(args.workdir) ?? ".",
        timeoutS: readNumber(args.timeout) ?? options?.timeoutS ?? 120,
    });
};

const runLocalFindFiles = async (args: OpenClawRpcArgs, options?: OpenClawRpcOptions): Promise<JsonObject> => {
    const searchPath = readString(args.path) ?? ".";
    resolveWorkspacePath(searchPath);
    const pattern = readString(args.pattern) ?? "**/*";
    const limit = readIntegerInRange(args.limit, 100, 1, 500);
    const result = await runLocalProcess(
        "find_files",
        "rg",
        ["--files", "--hidden", "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", pattern, searchPath],
        { timeoutS: options?.timeoutS ?? 45 },
    );
    const details = result.details && typeof result.details === "object" && !Array.isArray(result.details)
        ? result.details as JsonObject
        : {};
    const stdout = typeof details.stdout === "string" ? limitLines(details.stdout, limit) : "";
    return {
        ...result,
        details: { ...details, stdout, limit, pattern, path: searchPath },
    };
};

const runLocalGrepCode = async (args: OpenClawRpcArgs, options?: OpenClawRpcOptions): Promise<JsonObject> => {
    const pattern = readString(args.pattern) ?? readString(args.query) ?? readString(args.subtask);
    if (!pattern) {
        throw new OpenClawError("grep_code requires a pattern.");
    }
    const searchPath = readString(args.path) ?? ".";
    resolveWorkspacePath(searchPath);
    const limit = readIntegerInRange(args.limit, 80, 1, 500);
    const rgArgs = [
        "--line-number",
        "--hidden",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!dist/**",
        ...(args.literal === true ? ["--fixed-strings"] : []),
        ...(args.ignoreCase !== false ? ["--ignore-case"] : []),
        pattern,
        searchPath,
    ];
    const result = await runLocalProcess("grep_code", "rg", rgArgs, { timeoutS: options?.timeoutS ?? 45 });
    const details = result.details && typeof result.details === "object" && !Array.isArray(result.details)
        ? result.details as JsonObject
        : {};
    const stdout = typeof details.stdout === "string" ? limitLines(details.stdout, limit) : "";
    return {
        ...result,
        details: { ...details, stdout, limit, pattern, path: searchPath },
    };
};

const runLocalRead = async (args: OpenClawRpcArgs): Promise<JsonObject> => {
    const filePath = readString(args.path) ?? readString(args.subtask);
    if (!filePath) {
        throw new OpenClawError("ast_read requires a file path.");
    }
    const resolved = resolveWorkspacePath(filePath);
    const content = await fs.readFile(resolved, "utf8");
    return {
        status: "completed",
        details: {
            path: filePath,
            resolvedPath: resolved,
            bytes: Buffer.byteLength(content, "utf8"),
        },
        content,
    };
};

const runLocalPseudoTool = async (
    tool: string,
    args: OpenClawRpcArgs,
    options?: OpenClawRpcOptions,
): Promise<JsonObject | null> => {
    switch (tool) {
        case "shell_exec":
        case "run_tests": {
            const command = readString(args.command) ?? (tool === "run_tests" ? "npm run typecheck" : readString(args.subtask));
            if (!command) {
                throw new OpenClawError(`${tool} requires a command.`);
            }
            return await runLocalSafeCommand(tool, command, args, options);
        }
        case "ast_read":
            return await runLocalRead(args);
        case "find_files":
            return await runLocalFindFiles(args, options);
        case "grep_code":
            return await runLocalGrepCode(args, options);
        default:
            return null;
    }
};

const omitControlArgs = (args: OpenClawRpcArgs): JsonObject => {
    const { requireConfirmation, subtask, ...rest } = args;
    void requireConfirmation;
    void subtask;
    return rest;
};

const normalizeToolInvocation = (
    tool: string,
    args: OpenClawRpcArgs,
): { tool: string; args: JsonObject } => {
    switch (tool) {
        case "web_lookup": {
            const query = readString(args.query) ?? readString(args.subtask);
            if (!query) {
                throw new OpenClawError("web_lookup requires a query.");
            }
            return { tool: "web_search", args: { query } };
        }
        default:
            return { tool, args: omitControlArgs(args) };
    }
};

export const openclawRpc = async (
    tool: string,
    args: OpenClawRpcArgs,
    options?: OpenClawRpcOptions,
): Promise<JsonObject> => {
    if (args.requireConfirmation) {
        throw new OpenClawError(`HITL_REQUIRED: confirmation required before executing ${tool}.`);
    }

    const localResult = await runLocalPseudoTool(tool, args, options);
    if (localResult) {
        return localResult;
    }

    const normalized = normalizeToolInvocation(tool, args);
    const maxRetries = options?.maxRetries ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const response = await jsonPost<{ ok: boolean; result?: unknown; error?: { message?: string; type?: string } }>(
                "/tools/invoke",
                {
                    tool: normalized.tool,
                    args: normalized.args,
                    sessionKey: options?.sessionKey ?? "main",
                    ...(options?.action ? { action: options.action } : {}),
                    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
                },
                { timeoutS: options?.timeoutS ?? DEFAULT_TIMEOUT_S },
            );

            if (!response.ok) {
                throw new OpenClawError(response.error?.message ?? `OpenClaw rejected tool ${normalized.tool}.`);
            }

            if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
                return { value: response.result };
            }

            return response.result as JsonObject;
        } catch (error) {
            lastError = error;
            if (attempt >= maxRetries) {
                break;
            }
            await sleep(250 * 2 ** attempt);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new OpenClawError(`Failed to invoke OpenClaw tool ${tool} as ${normalized.tool}: ${message}`, {
        cause: lastError,
    });
};

export const storeArtifact = async (blob: string): Promise<string> => {
    const artifactDir = path.join(process.cwd(), ".openclaw_artifacts");
    await fs.mkdir(artifactDir, { recursive: true });

    const hash = crypto.createHash("sha256").update(blob).digest("hex").slice(0, 12);
    const fileName = `artifact-${Date.now()}-${hash}.txt`;
    const filePath = path.join(artifactDir, fileName);

    await fs.writeFile(filePath, blob, "utf-8");
    return `artifact://${fileName}`;
};
