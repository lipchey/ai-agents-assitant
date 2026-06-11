import "dotenv/config";
import { executeAgentRun } from "./app";
import {
    buildHitlResolver,
    loadActiveProfile,
    parseCliArgs,
    printReport,
    printRunArtifacts,
    readCostBudgetUsd,
    readPatchApplicationEnabled,
    resolveResumeProfile,
    USAGE_TEXT,
} from "./cli";
import type { CliArgs } from "./cli";
import { getLogger, getOutputWriter } from "./logging";
import type { Profile } from "./models";
import { isRunId } from "./run";
import { errorMessage } from "./shared";

/* Thin CLI over the programmatic run kernel (src/app/): argument parsing,
   profile selection, env-derived options, SIGINT wiring, and report printing.
   Everything that actually runs the agent lives in executeAgentRun. */

const run = async (): Promise<void> => {
    const logger = getLogger().child({ module: "main" });
    const output = getOutputWriter();

    let args: CliArgs;
    try {
        args = parseCliArgs(process.argv.slice(2));
    } catch (error) {
        output.errorLine(errorMessage(error));
        output.errorLine(USAGE_TEXT);
        process.exit(1);
    }

    if (args.help) {
        output.line(USAGE_TEXT);
        process.exit(0);
    }

    const { task, resumeRunId } = args;
    if (!task && resumeRunId === undefined) {
        output.errorLine(USAGE_TEXT);
        process.exit(1);
    }
    if (task && resumeRunId !== undefined) {
        output.errorLine("--resume takes no new task input.");
        output.errorLine(USAGE_TEXT);
        process.exit(1);
    }
    if (resumeRunId !== undefined && !isRunId(resumeRunId)) {
        output.errorLine(`--resume expects the runId printed by the original run (a UUID); got "${resumeRunId}".`);
        output.errorLine(USAGE_TEXT);
        process.exit(1);
    }

    /* Resolve the active profile up front: a resumed run must re-enter under its
       original profile (recovered from the run summary). */
    let profile: Profile;
    try {
        if (resumeRunId !== undefined) {
            const resolution = resolveResumeProfile(resumeRunId, args.profile);
            profile = resolution.profile;
            if (resolution.source === "recovered") {
                logger.info("Resume: recovered the original run's profile.", {
                    runId: resumeRunId,
                    profile: profile.name,
                });
            } else if (resolution.source === "fallback") {
                logger.warn("Resume: no readable run summary; using the default profile.", { runId: resumeRunId });
            } else if (resolution.recordedName !== undefined && resolution.recordedName !== profile.name) {
                logger.warn(
                    "Resume: honoring an explicitly selected profile that differs from the original run; mid-run bindings/budget may change.",
                    { runId: resumeRunId, recorded: resolution.recordedName, selected: profile.name },
                );
            }
        } else {
            profile = loadActiveProfile(args.profile);
        }
    } catch (error) {
        logger.error("Failed to start the agent runtime.", { error });
        process.exit(1);
    }

    const costBudgetUsd = readCostBudgetUsd(profile.budget?.costBudgetUsd);
    const patchApplicationEnabled = readPatchApplicationEnabled();

    let removeSigintHandler: (() => void) | undefined;
    try {
        const result = await executeAgentRun({
            ...(task ? { task } : {}),
            ...(resumeRunId !== undefined ? { resumeRunId } : {}),
            profile,
            costBudgetUsd,
            patchApplicationEnabled,
            hitlResolver: buildHitlResolver(),
            onRunReady: (handle) => {
                const onSigint = (): void => {
                    logger.warn("Run interrupted by SIGINT; writing failure summary.", { runId: handle.runId });
                    const path = handle.failRun(new Error("Run interrupted by SIGINT."));
                    if (path !== undefined) {
                        printRunArtifacts(handle.runId, path, output);
                    }
                    process.exit(130);
                };
                process.once("SIGINT", onSigint);
                removeSigintHandler = (): void => {
                    process.removeListener("SIGINT", onSigint);
                };
            },
        });

        if (result.finalState !== undefined) {
            printReport(result.finalState, costBudgetUsd, profile.name, output);
        } else {
            process.exitCode = 1;
        }
        printRunArtifacts(result.summary.runId, result.summaryPath, output);
    } catch {
        /* Startup failures are logged inside the kernel before the rethrow. */
        process.exit(1);
    } finally {
        removeSigintHandler?.();
    }
};

void run();
