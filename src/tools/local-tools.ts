/* Local pseudo-tools are the authoritative guard for path bounds and shell allowlists. */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { ToolName, ToolStatus, VERIFY_TYPECHECK_COMMAND } from "../consts/tools.js";
import { clampInt, readNumber, readString, truncate } from "../shared/text.js";
import type { JsonObject, OpenClawRpcArgs, OpenClawRpcOptions } from "../types/tools/rpc.js";
import { OpenClawError } from "./errors.js";
import { DEFAULT_TIMEOUT_S } from "./gateway.js";
import { resolveWorkspacePath } from "./workspace.js";

const MAX_PROCESS_OUTPUT_CHARS = 200_000;
const KILL_GRACE_MS = 5_000;

/* Re-check this allowlist in the exec adapter even when callers pre-validate. */
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

const limitLines = (value: string, limit: number): string => value.split(/\r?\n/u).slice(0, limit).join("\n");

/* No shell, bounded output, and SIGTERM-to-SIGKILL on timeout. */
const runLocalProcess = async (
    label: string,
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutS?: number; maxOutputChars?: number },
): Promise<JsonObject> => {
    const cwd = options?.cwd ? resolveWorkspacePath(options.cwd) : process.cwd();
    const timeoutMs = (options?.timeoutS ?? DEFAULT_TIMEOUT_S) * 1_000;
    const maxOutputChars = options?.maxOutputChars ?? MAX_PROCESS_OUTPUT_CHARS;

    return await new Promise<JsonObject>((resolve) => {
        const child = spawn(command, args, { cwd, env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let forceKillTimer: NodeJS.Timeout | undefined;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            forceKillTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
            stdout = truncate(`${stdout}${chunk.toString("utf8")}`, maxOutputChars);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr = truncate(`${stderr}${chunk.toString("utf8")}`, maxOutputChars);
        });
        child.once("error", (error) => {
            clearTimeout(timer);
            if (forceKillTimer) {
                clearTimeout(forceKillTimer);
            }
            resolve({ status: ToolStatus.FAILED, details: { label, command, args, cwd, error: error.message, stdout, stderr } });
        });
        child.once("exit", (exitCode, signal) => {
            clearTimeout(timer);
            if (forceKillTimer) {
                clearTimeout(forceKillTimer);
            }
            const status = timedOut ? ToolStatus.TIMED_OUT : signal ? ToolStatus.FAILED : ToolStatus.COMPLETED;
            resolve({ status, details: { label, command, args, cwd, exitCode, signal, stdout, stderr } });
        });
    });
};

const readDetails = (result: JsonObject): JsonObject => {
    return result.details && typeof result.details === "object" && !Array.isArray(result.details)
        ? result.details as JsonObject
        : {};
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
    const limit = clampInt(args.limit, 100, 1, 500);
    const result = await runLocalProcess(
        ToolName.FIND_FILES,
        "rg",
        ["--files", "--hidden", "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", pattern, searchPath],
        { timeoutS: options?.timeoutS ?? 45 },
    );
    const details = readDetails(result);
    const stdout = typeof details.stdout === "string" ? limitLines(details.stdout, limit) : "";
    return { ...result, details: { ...details, stdout, limit, pattern, path: searchPath } };
};

const runLocalGrepCode = async (args: OpenClawRpcArgs, options?: OpenClawRpcOptions): Promise<JsonObject> => {
    const pattern = readString(args.pattern) ?? readString(args.query) ?? readString(args.subtask);
    if (!pattern) {
        throw new OpenClawError("grep_code requires a pattern.");
    }
    const searchPath = readString(args.path) ?? ".";
    resolveWorkspacePath(searchPath);
    const limit = clampInt(args.limit, 80, 1, 500);
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
    const result = await runLocalProcess(ToolName.GREP_CODE, "rg", rgArgs, { timeoutS: options?.timeoutS ?? 45 });
    const details = readDetails(result);
    const stdout = typeof details.stdout === "string" ? limitLines(details.stdout, limit) : "";
    return { ...result, details: { ...details, stdout, limit, pattern, path: searchPath } };
};

const runLocalRead = async (args: OpenClawRpcArgs): Promise<JsonObject> => {
    const filePath = readString(args.path) ?? readString(args.subtask);
    if (!filePath) {
        throw new OpenClawError("ast_read requires a file path.");
    }
    const resolved = resolveWorkspacePath(filePath);
    const content = await fs.readFile(resolved, "utf8");
    return {
        status: ToolStatus.COMPLETED,
        details: { path: filePath, resolvedPath: resolved, bytes: Buffer.byteLength(content, "utf8") },
        content,
    };
};

export const runLocalPseudoTool = async (
    tool: string,
    args: OpenClawRpcArgs,
    options?: OpenClawRpcOptions,
): Promise<JsonObject | null> => {
    switch (tool) {
        case ToolName.SHELL_EXEC:
        case ToolName.RUN_TESTS: {
            const command = readString(args.command)
                ?? (tool === ToolName.RUN_TESTS ? VERIFY_TYPECHECK_COMMAND : readString(args.subtask));
            if (!command) {
                throw new OpenClawError(`${tool} requires a command.`);
            }
            return await runLocalSafeCommand(tool, command, args, options);
        }
        case ToolName.AST_READ:
            return await runLocalRead(args);
        case ToolName.FIND_FILES:
            return await runLocalFindFiles(args, options);
        case ToolName.GREP_CODE:
            return await runLocalGrepCode(args, options);
        default:
            return null;
    }
};
