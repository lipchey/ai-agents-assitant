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
    | "router"
    | "sme";

type ModelPricing = {
    inputPer1M: number;
    outputPer1M: number;
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
    };
};

export type LlmCallResult = {
    content: string;
    tokens: number;
    cost: number;
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

const loadPricing = async (): Promise<Record<string, ModelPricing>> => {
    try {
        const pricingFile = await fs.readFile(path.join(process.cwd(), "src", "pricing.json"), "utf8");
        return JSON.parse(pricingFile) as Record<string, ModelPricing>;
    } catch {
        return {};
    }
};

const modelForRole = (modelKey: string): { modelRef: string; temperature: number } => {
    const role = modelKey as ModelRole;
    switch (role) {
        case "architect":
        case "sme":
            return { modelRef: "anthropic/claude-opus-4-8", temperature: 0.2 };
        case "coder":
            return { modelRef: "anthropic/claude-sonnet-4-6", temperature: 0.2 };
        case "critic":
            return { modelRef: "openai/gpt-5.5", temperature: 0.1 };
        case "firewall":
        case "router":
            return { modelRef: "deepseek/deepseek-v4-flash", temperature: 0 };
        default:
            return { modelRef: "deepseek/deepseek-v4-flash", temperature: 0.2 };
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

export const callLlm = async (
    modelKey: string,
    system: string,
    user: string,
): Promise<LlmCallResult> => {
    const { modelRef, temperature } = modelForRole(modelKey);

    const response = await jsonPost<ChatCompletionResponse>(
        "/v1/chat/completions",
        {
            model: "openclaw/default",
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            temperature,
            stream: false,
            user: `ai-agents-assitant:${modelKey}`,
        },
        {
            timeoutS: 180,
            headers: {
                "x-openclaw-model": modelRef,
            },
        },
    );

    const content = contentToString(response.choices?.[0]?.message?.content);
    if (!content) {
        throw new OpenClawError(`OpenClaw returned an empty assistant message for ${modelKey} (${modelRef}).`);
    }

    const usage = response.usage ?? {};
    const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
    const pricing = (await loadPricing())[modelRef];
    const cost = pricing
        ? (inputTokens / 1_000_000) * pricing.inputPer1M + (outputTokens / 1_000_000) * pricing.outputPer1M
        : 0;

    return { content, tokens: totalTokens, cost };
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

const SAFE_DIRECT_EXEC_COMMANDS = new Set([
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

const resolveWorkspacePath = (inputPath: string): string => {
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
