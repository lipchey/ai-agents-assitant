export const ToolName = {
    FIND_FILES: "find_files",
    GREP_CODE: "grep_code",
    AST_READ: "ast_read",
    SHELL_EXEC: "shell_exec",
    WEB_LOOKUP: "web_lookup",
    RUN_TESTS: "run_tests",
    TAVILY_SEARCH: "tavily_search",
    WEB_SEARCH: "web_search",
} as const;

export type ToolName = (typeof ToolName)[keyof typeof ToolName];

export const ToolStatus = {
    COMPLETED: "completed",
    FAILED: "failed",
    TIMED_OUT: "timed_out",
} as const;

export type ToolStatus = (typeof ToolStatus)[keyof typeof ToolStatus];

/* Must stay allowlisted in SAFE_DIRECT_EXEC_COMMANDS. */
export const VERIFY_TYPECHECK_COMMAND = "npm run typecheck";
