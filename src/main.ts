import "dotenv/config";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
import {
    CHECKPOINT_DB_PATH,
    HITL_RESOLVER_CONFIG_KEY,
    MAIN_GRAPH_RECURSION_LIMIT,
    ModelTransport,
    PROFILE_CONFIG_KEY,
    RUN_CONTEXT_CONFIG_KEY,
    RunStatus,
    THREAD_ID_CONFIG_KEY,
    TOOL_REGISTRY_CONFIG_KEY,
} from "./consts";
import { buildMainGraph, isCostBudgetNear } from "./graph";
import { getLogger, getOutputWriter } from "./logging";
import { effectiveTransports } from "./models";
import type { Profile } from "./models";
import { buildRunSummary, createRunContext, isRunId, writeRunSummary } from "./run";
import type { RunContext } from "./run";
import { asRecord, errorMessage } from "./shared";
import { getDefaultToolRegistry, startOpenClawGateway, stopOpenClawGateway } from "./tools";

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

    /* One shared registry: the same instance the compatibility seams and DI fallbacks resolve to. */
    const tools = getDefaultToolRegistry();

    /* Resolve the active profile BEFORE touching the gateway: a resumed run must
       re-enter under its original profile (recovered from the run summary), and the
       gateway is only started when an LLM binding or a registered tool needs it. */
    let profile: Profile;
    let gatewayStarted = false;
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

        /* The gateway is also the web-search backend, so it is required when any
           tool provider routes through it — not only when an LLM binding does. */
        const needsGateway = effectiveTransports(profile).has(ModelTransport.OPENCLAW) || tools.requiresGateway();
        if (needsGateway) {
            logger.info("Ensuring OpenClaw Gateway is running.");
            await startOpenClawGateway();
            gatewayStarted = true;
        } else {
            logger.info("Direct transport and no gateway-backed tool in use; skipping OpenClaw Gateway startup.");
        }
        await tools.start();
        logger.info("Runtime ready. Starting agent.", { taskPreview: task, gateway: gatewayStarted });
    } catch (error) {
        logger.error("Failed to start the agent runtime.", { error });
        if (gatewayStarted) {
            await stopOpenClawGateway();
        }
        await tools.stop();
        process.exit(1);
    }

    /* Declared before the try so the catch/SIGINT paths can reach them; a failure
       before the run context exists has no partial usage worth reporting. */
    let runContext: RunContext | undefined;
    let summaryWritten = false;
    /* In resume mode the CLI carries no task, so the summary task is recovered
       from the checkpoint below; both the failure and success paths read this. */
    let summaryTask = task;
    const writeFailureSummary = (error: unknown): void => {
        if (summaryWritten || runContext === undefined) {
            return;
        }
        const summary = buildRunSummary({
            runContext,
            task: summaryTask,
            status: RunStatus.FAILED,
            answer: "",
            totalCostUsd: runContext.usage.totalCostUsd,
            totalTokens: runContext.usage.totalTokens,
            usageStats: runContext.usage.usageStats,
            error: errorMessage(error),
        });
        const path = writeRunSummary(summary);
        summaryWritten = true;
        printRunArtifacts(runContext.runId, path, output);
        logger.info("Run summary written.", { runId: runContext.runId, path, status: RunStatus.FAILED });
    };

    const onSigint = (): void => {
        logger.warn(
            "Run interrupted by SIGINT; writing failure summary.",
            runContext ? { runId: runContext.runId } : {},
        );
        writeFailureSummary(new Error("Run interrupted by SIGINT."));
        process.exit(130);
    };

    try {
        const costBudgetUsd = readCostBudgetUsd(profile.budget?.costBudgetUsd);
        const patchApplicationEnabled = readPatchApplicationEnabled();
        if (patchApplicationEnabled) {
            logger.info("Patch application enabled; verified changes will be written to the repository.");
        }
        logger.info("Active profile resolved.", { profile: profile.name, costBudgetUsd });

        runContext = createRunContext({ profileName: profile.name, ...(resumeRunId ? { runId: resumeRunId } : {}) });

        /* thread_id keys the SqliteSaver checkpoint; reusing runId makes --resume re-enter the same thread. */
        mkdirSync(dirname(CHECKPOINT_DB_PATH), { recursive: true });
        const checkpointer = SqliteSaver.fromConnString(CHECKPOINT_DB_PATH);
        const graph = buildMainGraph({ checkpointer });

        if (resumeRunId) {
            /* Recover the original task from the checkpointed thread so a failed
               resumed run still records it, and fail fast on a runId with no
               checkpoint instead of silently re-entering an empty thread. */
            const prior = await graph.getState({ configurable: { [THREAD_ID_CONFIG_KEY]: runContext.runId } });
            const priorTask = asRecord(prior.values)?.originalTask;
            if (typeof priorTask !== "string" || priorTask.length === 0) {
                throw new Error(`No checkpoint found for runId "${resumeRunId}".`);
            }
            summaryTask = priorTask;
        }

        const taskInput = { originalTask: task, costBudgetUsd, patchApplicationEnabled };
        /* LangGraph resume semantics: a null input re-enters the checkpointed thread
           keyed by thread_id without supplying new graph state. */
        const input = resumeRunId ? (null as unknown as typeof taskInput) : taskInput;

        process.once("SIGINT", onSigint);
        const finalState = await graph.invoke(input, {
            recursionLimit: MAIN_GRAPH_RECURSION_LIMIT,
            /* Keep the non-serializable HITL resolver, profile, registry, and run context out of checkpointed state. */
            configurable: {
                [HITL_RESOLVER_CONFIG_KEY]: buildHitlResolver(),
                [TOOL_REGISTRY_CONFIG_KEY]: tools,
                [PROFILE_CONFIG_KEY]: profile,
                [THREAD_ID_CONFIG_KEY]: runContext.runId,
                [RUN_CONTEXT_CONFIG_KEY]: runContext,
            },
        });
        process.removeListener("SIGINT", onSigint);

        /* Heuristic: a run that ends inside the soft-ceiling stop zone is reported budget_stopped. */
        const status = isCostBudgetNear(finalState) ? RunStatus.BUDGET_STOPPED : RunStatus.COMPLETED;
        const answer = finalState.finalAnswer || finalState.bestDraft || finalState.currentDraft || "";
        const summary = buildRunSummary({
            runContext,
            task: finalState.originalTask || summaryTask,
            status,
            answer,
            totalCostUsd: finalState.totalCost,
            totalTokens: finalState.totalTokens,
            usageStats: finalState.usageStats,
            ...(typeof finalState.verificationPassed === "boolean"
                ? { verificationPassed: finalState.verificationPassed }
                : {}),
        });
        const path = writeRunSummary(summary);
        summaryWritten = true;

        printReport(finalState, costBudgetUsd, profile.name, output);
        printRunArtifacts(runContext.runId, path, output);
        logger.info("Run summary written.", { runId: runContext.runId, path, status });
    } catch (error) {
        logger.error("Agent execution failed.", { error });
        writeFailureSummary(error);
        process.exitCode = 1;
    } finally {
        process.removeListener("SIGINT", onSigint);
        await tools.stop();
        if (gatewayStarted) {
            await stopOpenClawGateway();
        }
    }
};

void run();
