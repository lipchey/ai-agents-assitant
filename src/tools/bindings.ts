import { BuiltInToolId, ToolName } from "../consts";
import type { QualifiedToolId, ToolAlias } from "../types/tools";

export const DEFAULT_TOOL_BINDINGS = {
    [ToolName.FIND_FILES]: BuiltInToolId.LOCAL_FIND_FILES,
    [ToolName.GREP_CODE]: BuiltInToolId.LOCAL_GREP_CODE,
    [ToolName.AST_READ]: BuiltInToolId.LOCAL_AST_READ,
    [ToolName.SHELL_EXEC]: BuiltInToolId.LOCAL_SHELL_EXEC,
    [ToolName.WEB_LOOKUP]: BuiltInToolId.WEB_LOOKUP,
    [ToolName.RUN_TESTS]: BuiltInToolId.LOCAL_RUN_TESTS,
} as const satisfies Record<ToolAlias, QualifiedToolId>;
