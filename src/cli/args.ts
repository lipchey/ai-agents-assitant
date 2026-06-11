import { CHECKPOINT_DB_PATH } from "../consts";

export type CliArgs = { task: string; profile?: string; resumeRunId?: string; help: boolean };

export const USAGE_TEXT = [
    'Usage: npm start -- [--profile <name|path>] "<task description>"',
    "       npm start -- --resume <runId>",
    "       npm start -- --help",
    "",
    "Options:",
    '  "<task>"               Run the agent on a new task.',
    "  --profile <name|path>  Select the model profile: a name under profiles/",
    '                         (profiles/<name>.json5) or a .json5 path. Default "default".',
    `  --resume <runId>       Resume a checkpointed run from ${CHECKPOINT_DB_PATH}`,
    "                         (use the UUID printed by the original run; no new task input).",
    "  -h, --help             Show this help and exit.",
    "",
    "Environment:",
    "  AGENT_PROFILE          Profile name or path; the --profile flag wins over it.",
    "  AGENT_COST_BUDGET_USD  Override the active profile cost budget.",
    "  AGENT_APPLY_PATCHES    Write verified changes to the repository when truthy.",
].join("\n");

export const parseCliArgs = (argv: string[]): CliArgs => {
    let help = false;
    let profile: string | undefined;
    let resumeRunId: string | undefined;
    const taskTokens: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === undefined) {
            continue;
        }
        if (token === "--help" || token === "-h") {
            help = true;
            continue;
        }
        if (token === "--profile") {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith("-")) {
                throw new Error("--profile requires a <name|path> value.");
            }
            profile = value;
            index += 1;
            continue;
        }
        if (token === "--resume") {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith("-")) {
                throw new Error("--resume requires a <runId> value.");
            }
            resumeRunId = value;
            index += 1;
            continue;
        }
        taskTokens.push(token);
    }

    const task = taskTokens.join(" ").trim();
    return {
        task,
        help,
        ...(profile !== undefined ? { profile } : {}),
        ...(resumeRunId !== undefined ? { resumeRunId } : {}),
    };
};
