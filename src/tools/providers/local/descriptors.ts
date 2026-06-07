import {
    BuiltInToolId,
    SAFE_DIRECT_EXEC_COMMANDS,
    SHELL_EXEC_TIMEOUT_S,
    ToolCapability,
    ToolErrorKind,
    ToolName,
    ToolProviderName,
    VERIFY_TYPECHECK_COMMAND,
    WorkerKind,
} from "../../../consts";
import { clampInt, readString } from "../../../shared";
import type { SanitizedAction, ToolArgs, ToolCallContext, ToolDescriptor, ToolResult } from "../../../types/tools";
import { ToolError } from "../../errors.ts";
import { runLocalPseudoTool } from "../../local-tools.ts";
import { createToolResult } from "../../results.ts";

type LocalDescriptorConfig = {
    readonly id: BuiltInToolId;
    readonly alias: ToolName;
    readonly capabilities: readonly ToolCapability[];
    readonly suggestedKinds: readonly WorkerKind[];
    readonly description: string;
    validate(args: ToolArgs): SanitizedAction;
};

const invokeLocal = async (id: BuiltInToolId, alias: ToolName, args: ToolArgs, context?: ToolCallContext): Promise<ToolResult> => {
    const payload = await runLocalPseudoTool(alias, args, context);
    if (!payload) {
        throw new ToolError(ToolErrorKind.EXECUTION, `Local provider does not own ${alias}.`, {
            provider: ToolProviderName.LOCAL,
            toolId: id,
        });
    }
    return createToolResult(ToolProviderName.LOCAL, id, payload, alias);
};

const localDescriptor = (config: LocalDescriptorConfig): ToolDescriptor => ({
    id: config.id,
    aliases: [config.alias],
    capabilities: config.capabilities,
    suggestedKinds: config.suggestedKinds,
    description: config.description,
    validate: config.validate,
    invoke: (args, context) => invokeLocal(config.id, config.alias, args, context),
});

export const localDescriptors: readonly ToolDescriptor[] = [
    localDescriptor({
        id: BuiltInToolId.LOCAL_FIND_FILES,
        alias: ToolName.FIND_FILES,
        capabilities: [ToolCapability.READ_WORKSPACE],
        suggestedKinds: [WorkerKind.CODE_EXPLORER, WorkerKind.INFRA_OPS],
        description: '{"path":".","pattern":"src/**/*.ts","limit":100}: list files by glob.',
        validate: (rawArgs) => {
            const pattern = readString(rawArgs.pattern) ?? "src/**/*.ts";
            const path = readString(rawArgs.path) ?? ".";
            const limit = clampInt(rawArgs.limit, 100, 1, 500);
            return { ok: true, alias: ToolName.FIND_FILES, args: { path, pattern, limit } };
        },
    }),
    localDescriptor({
        id: BuiltInToolId.LOCAL_GREP_CODE,
        alias: ToolName.GREP_CODE,
        capabilities: [ToolCapability.READ_WORKSPACE],
        suggestedKinds: [WorkerKind.CODE_EXPLORER, WorkerKind.INFRA_OPS],
        description: '{"pattern":"regex","path":".","ignoreCase":false,"literal":false,"limit":80}: search file contents.',
        validate: (rawArgs) => {
            const pattern = readString(rawArgs.pattern) ?? readString(rawArgs.query);
            if (!pattern) {
                return { ok: false, error: 'grep_code requires a non-empty "pattern".' };
            }
            const path = readString(rawArgs.path) ?? ".";
            const limit = clampInt(rawArgs.limit, 80, 1, 500);
            return {
                ok: true,
                alias: ToolName.GREP_CODE,
                args: { path, pattern, ignoreCase: rawArgs.ignoreCase !== false, literal: rawArgs.literal === true, limit },
            };
        },
    }),
    localDescriptor({
        id: BuiltInToolId.LOCAL_AST_READ,
        alias: ToolName.AST_READ,
        capabilities: [ToolCapability.READ_WORKSPACE],
        suggestedKinds: [WorkerKind.CODE_EXPLORER, WorkerKind.INFRA_OPS],
        description: '{"path":"src/file.ts"}: read one file in full.',
        validate: (rawArgs) => {
            const path = readString(rawArgs.path) ?? readString(rawArgs.subtask);
            if (!path) {
                return { ok: false, error: 'ast_read requires a "path" to a file.' };
            }
            return { ok: true, alias: ToolName.AST_READ, args: { path } };
        },
    }),
    localDescriptor({
        id: BuiltInToolId.LOCAL_SHELL_EXEC,
        alias: ToolName.SHELL_EXEC,
        capabilities: [ToolCapability.EXEC_ALLOWLISTED],
        suggestedKinds: [WorkerKind.INFRA_OPS],
        description: '{"command":"<allowlisted>","timeout":120}: run one allowlisted command.',
        validate: (rawArgs) => {
            const command = readString(rawArgs.command);
            if (!command) {
                return { ok: false, error: 'shell_exec requires a "command".' };
            }
            if (!SAFE_DIRECT_EXEC_COMMANDS.has(command)) {
                return {
                    ok: false,
                    error: `Command "${command}" is not allowlisted. Choose exactly one of: ${[...SAFE_DIRECT_EXEC_COMMANDS].join(" | ")}.`,
                };
            }
            return { ok: true, alias: ToolName.SHELL_EXEC, args: { command, timeout: SHELL_EXEC_TIMEOUT_S } };
        },
    }),
    localDescriptor({
        id: BuiltInToolId.LOCAL_RUN_TESTS,
        alias: ToolName.RUN_TESTS,
        capabilities: [ToolCapability.EXEC_ALLOWLISTED],
        suggestedKinds: [WorkerKind.INFRA_OPS],
        description: '{"command":"npm run typecheck","timeout":120}: run the objective verification command.',
        validate: (rawArgs) => {
            const command = readString(rawArgs.command) ?? VERIFY_TYPECHECK_COMMAND;
            if (!SAFE_DIRECT_EXEC_COMMANDS.has(command)) {
                return {
                    ok: false,
                    error: `Command "${command}" is not allowlisted. Choose exactly one of: ${[...SAFE_DIRECT_EXEC_COMMANDS].join(" | ")}.`,
                };
            }
            return typeof rawArgs.timeout === "number"
                ? { ok: true, alias: ToolName.RUN_TESTS, args: { command, timeout: rawArgs.timeout } }
                : { ok: true, alias: ToolName.RUN_TESTS, args: { command } };
        },
    }),
];
