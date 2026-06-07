export const ToolName = {
    FIND_FILES: "find_files",
    GREP_CODE: "grep_code",
    AST_READ: "ast_read",
    SHELL_EXEC: "shell_exec",
    WEB_LOOKUP: "web_lookup",
    RUN_TESTS: "run_tests",
} as const;

export type ToolName = (typeof ToolName)[keyof typeof ToolName];

export const isToolName = (value: unknown): value is ToolName =>
    typeof value === "string" && Object.values(ToolName).includes(value as ToolName);

export const ToolStatus = {
    COMPLETED: "completed",
    FAILED: "failed",
    TIMED_OUT: "timed_out",
} as const;

export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];

export const isToolStatus = (value: unknown): value is ToolStatus =>
    typeof value === "string" && Object.values(ToolStatus).includes(value as ToolStatus);

export const ToolProviderName = {
    LOCAL: "local",
    WEB: "web",
} as const;

export type ToolProviderName = (typeof ToolProviderName)[keyof typeof ToolProviderName];

export const BuiltInToolId = {
    LOCAL_FIND_FILES: `${ToolProviderName.LOCAL}:find_files`,
    LOCAL_GREP_CODE: `${ToolProviderName.LOCAL}:grep_code`,
    LOCAL_AST_READ: `${ToolProviderName.LOCAL}:ast_read`,
    LOCAL_SHELL_EXEC: `${ToolProviderName.LOCAL}:shell_exec`,
    LOCAL_RUN_TESTS: `${ToolProviderName.LOCAL}:run_tests`,
    WEB_LOOKUP: `${ToolProviderName.WEB}:lookup`,
} as const;

export type BuiltInToolId = (typeof BuiltInToolId)[keyof typeof BuiltInToolId];

export const ToolCapability = {
    READ_WORKSPACE: "read_workspace",
    WRITE_WORKSPACE: "write_workspace",
    EXEC_ALLOWLISTED: "exec_allowlisted",
    EXTERNAL_NETWORK: "external_network",
} as const;

export type ToolCapability = (typeof ToolCapability)[keyof typeof ToolCapability];

export const ToolErrorKind = {
    VALIDATION: "validation",
    POLICY: "policy",
    TIMEOUT: "timeout",
    ENVIRONMENT: "environment",
    PROVIDER_UNAVAILABLE: "provider_unavailable",
    EXECUTION: "execution",
} as const;

export type ToolErrorKind = (typeof ToolErrorKind)[keyof typeof ToolErrorKind];

export const TOOL_REGISTRY_CONFIG_KEY = "toolRegistry";

/* Must stay allowlisted in SAFE_DIRECT_EXEC_COMMANDS. */
export const GIT_STATUS_SHORT_COMMAND = "git status --short";
export const NPM_RUN_BUILD_COMMAND = "npm run build";
export const NPM_RUN_TEST_COMMAND = "npm run test";
export const VERIFY_TYPECHECK_COMMAND = "npm run typecheck";
export const NPM_TEST_COMMAND = "npm test";
export const TSC_NO_EMIT_COMMAND = "npx tsc --noEmit";

/* Local process output is evidence, but it must stay bounded in memory. */
export const MAX_PROCESS_OUTPUT_CHARS = 200_000;

/* Timed-out local processes get a graceful SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 5_000;

/* Re-check this allowlist in the exec adapter even when callers pre-validate. */
export const SAFE_COMMAND_SPECS = {
    [GIT_STATUS_SHORT_COMMAND]: { command: "git", args: ["status", "--short"] },
    [NPM_RUN_BUILD_COMMAND]: { command: "npm", args: ["run", "build"] },
    [NPM_RUN_TEST_COMMAND]: { command: "npm", args: ["run", "test"] },
    [VERIFY_TYPECHECK_COMMAND]: { command: "npm", args: ["run", "typecheck"] },
    [NPM_TEST_COMMAND]: { command: "npm", args: ["test"] },
    [TSC_NO_EMIT_COMMAND]: { command: "npx", args: ["tsc", "--noEmit"] },
} as const;

export type SafeDirectExecCommand = keyof typeof SAFE_COMMAND_SPECS;

export const SAFE_DIRECT_EXEC_COMMANDS = new Set<string>(Object.keys(SAFE_COMMAND_SPECS));

export const isSafeDirectExecCommand = (command: string): command is SafeDirectExecCommand =>
    command in SAFE_COMMAND_SPECS;
