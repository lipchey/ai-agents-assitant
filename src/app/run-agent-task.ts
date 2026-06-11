import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
    CHECKPOINT_DB_PATH,
    DEFAULT_COST_BUDGET_USD,
    DEFAULT_PROFILE_NAME,
    HITL_RESOLVER_CONFIG_KEY,
    MAIN_GRAPH_RECURSION_LIMIT,
    ModelTransport,
    PROFILE_CONFIG_KEY,
    RUN_CONTEXT_CONFIG_KEY,
    RunStatus,
    THREAD_ID_CONFIG_KEY,
    TOOL_REGISTRY_CONFIG_KEY,
} from "../consts";
import { buildMainGraph, isCostBudgetNear } from "../graph";
import { autoAbortResolver } from "../hitl";
import { getLogger } from "../logging";
import { effectiveTransports, loadProfile } from "../models";
import type { Profile } from "../models";
import { buildRunSummary, createRunContext, writeRunSummary } from "../run";
import type { RunContext, RunSummary } from "../run";
import { asRecord, errorMessage } from "../shared";
import { getDefaultToolRegistry, setWorkspaceRoot, startOpenClawGateway, stopOpenClawGateway } from "../tools";
import type { GraphStateValue } from "../state";
import type { HitlResolver } from "../types/hitl";
import type { ToolRegistry } from "../types/tools";

/* Composition root for one agent run: runtime startup, run kernel wiring, graph
   invocation, and the RunSummary on every termination path. The CLI (main.ts)
   and the bench provider both ride this module; it never calls process.exit. */

export type AgentRunHandle = {
    runId: string;
    /* Write the failed RunSummary for the in-flight run and return its path;
       undefined once any summary was already written. Lets the CLI wire a
       SIGINT handler around the run without owning the summary writer. */
    failRun: (error: unknown) => string | undefined;
};

export type ExecuteAgentRunInput = {
    /* Absent only in resume mode; the task is then recovered from the checkpoint. */
    task?: string;
    resumeRunId?: string;
    profile: Profile;
    costBudgetUsd: number;
    patchApplicationEnabled: boolean;
    hitlResolver: HitlResolver;
    /* Tool registry for this run; offline/e2e callers inject a local-only registry
       so no gateway-backed provider forces an OpenClaw startup. */
    tools?: ToolRegistry;
    /* Work-tree root for filesystem tools and patching; process.cwd() when absent
       (profile/pricing loading stays cwd-anchored regardless — see workspace.ts). */
    workspaceDir?: string;
    /* Called once the run context exists, before the graph is invoked. */
    onRunReady?: (handle: AgentRunHandle) => void;
};

export type ExecuteAgentRunResult = {
    summary: RunSummary;
    summaryPath: string;
    /* Present only when the graph completed (completed / budget_stopped). */
    finalState?: GraphStateValue;
};

/* Throws only on runtime startup failure (gateway / tool registry), i.e. before
   a run context exists; from then on every failure is reported through a
   status:"failed" RunSummary instead of a rejection (spec §3.4: a summary is
   written on every termination path). */
export const executeAgentRun = async (input: ExecuteAgentRunInput): Promise<ExecuteAgentRunResult> => {
    const logger = getLogger().child({ module: "app" });
    const { profile, resumeRunId } = input;

    /* One shared registry: the same instance the compatibility seams and DI fallbacks
       resolve to, unless a caller injects a local-only registry for an offline run. */
    const tools = input.tools ?? getDefaultToolRegistry();

    /* Relocate the work tree before startup so filesystem tools and patching follow
       the injected root; reset on every exit path below. */
    if (input.workspaceDir !== undefined) {
        setWorkspaceRoot(resolve(input.workspaceDir));
    }

    /* The gateway is also the web-search backend, so it is required when any
       tool provider routes through it — not only when an LLM binding does. */
    let gatewayStarted = false;
    try {
        const needsGateway = effectiveTransports(profile).has(ModelTransport.OPENCLAW) || tools.requiresGateway();
        if (needsGateway) {
            logger.info("Ensuring OpenClaw Gateway is running.");
            await startOpenClawGateway();
            gatewayStarted = true;
        } else {
            logger.info("Direct transport and no gateway-backed tool in use; skipping OpenClaw Gateway startup.");
        }
        await tools.start();
        logger.info("Runtime ready. Starting agent.", { taskPreview: input.task, gateway: gatewayStarted });
    } catch (error) {
        logger.error("Failed to start the agent runtime.", { error });
        if (gatewayStarted) {
            await stopOpenClawGateway();
        }
        await tools.stop();
        if (input.workspaceDir !== undefined) {
            setWorkspaceRoot(undefined);
        }
        throw error;
    }

    let runContext: RunContext | undefined;
    let summaryWritten = false;
    /* In resume mode the caller carries no task, so the summary task is recovered
       from the checkpoint below; both the failure and success paths read this. */
    let summaryTask = input.task ?? "";
    const writeFailureSummary = (error: unknown): string | undefined => {
        if (summaryWritten || runContext === undefined) {
            return undefined;
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
        logger.info("Run summary written.", { runId: runContext.runId, path, status: RunStatus.FAILED });
        return path;
    };

    try {
        if (input.patchApplicationEnabled) {
            logger.info("Patch application enabled; verified changes will be written to the repository.");
        }
        logger.info("Active profile resolved.", { profile: profile.name, costBudgetUsd: input.costBudgetUsd });

        runContext = createRunContext({
            profileName: profile.name,
            ...(resumeRunId !== undefined ? { runId: resumeRunId } : {}),
        });

        /* thread_id keys the SqliteSaver checkpoint; reusing runId makes --resume re-enter the same thread. */
        mkdirSync(dirname(CHECKPOINT_DB_PATH), { recursive: true });
        const checkpointer = SqliteSaver.fromConnString(CHECKPOINT_DB_PATH);
        const graph = buildMainGraph({ checkpointer });

        if (resumeRunId !== undefined) {
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

        const handle: AgentRunHandle = { runId: runContext.runId, failRun: writeFailureSummary };
        input.onRunReady?.(handle);

        const taskInput = {
            originalTask: input.task ?? "",
            costBudgetUsd: input.costBudgetUsd,
            patchApplicationEnabled: input.patchApplicationEnabled,
        };
        /* LangGraph resume semantics: a null input re-enters the checkpointed thread
           keyed by thread_id without supplying new graph state. */
        const graphInput = resumeRunId !== undefined ? (null as unknown as typeof taskInput) : taskInput;

        const finalState = await graph.invoke(graphInput, {
            recursionLimit: MAIN_GRAPH_RECURSION_LIMIT,
            /* Keep the non-serializable HITL resolver, profile, registry, and run context out of checkpointed state. */
            configurable: {
                [HITL_RESOLVER_CONFIG_KEY]: input.hitlResolver,
                [TOOL_REGISTRY_CONFIG_KEY]: tools,
                [PROFILE_CONFIG_KEY]: profile,
                [THREAD_ID_CONFIG_KEY]: runContext.runId,
                [RUN_CONTEXT_CONFIG_KEY]: runContext,
            },
        });

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
        const summaryPath = writeRunSummary(summary);
        summaryWritten = true;
        logger.info("Run summary written.", { runId: runContext.runId, path: summaryPath, status });
        return { summary, summaryPath, finalState };
    } catch (error) {
        logger.error("Agent execution failed.", { error });
        const summaryPath = writeFailureSummary(error);
        if (runContext === undefined || summaryPath === undefined) {
            /* No run context yet (e.g. an invalid resume runId) — nothing to summarize. */
            throw error;
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
        return { summary, summaryPath };
    } finally {
        await tools.stop();
        if (gatewayStarted) {
            await stopOpenClawGateway();
        }
        if (input.workspaceDir !== undefined) {
            setWorkspaceRoot(undefined);
        }
    }
};

export type RunAgentTaskOptions = {
    /* Profile name under profiles/, a .json5 path, or a pre-loaded Profile. */
    profile?: string | Profile;
    /* Soft USD ceiling; defaults to the profile budget, then the global default.
       Deliberately NOT overridable via AGENT_COST_BUDGET_USD — the programmatic
       entrypoint stays deterministic for bench comparability. */
    budgetUsd?: number;
    applyPatches?: boolean;
    /* Pinned off: the programmatic entrypoint must never block on stdin. */
    hitl?: "off";
    /* Work-tree root for filesystem tools and patching; validated at the boundary
       and threaded to executeAgentRun. Profile/pricing loading stays cwd-anchored. */
    workspaceDir?: string;
    /* Offline/e2e callers inject a local-only tool registry so no gateway-backed
       provider forces an OpenClaw startup. */
    tools?: ToolRegistry;
};

/* Programmatic entrypoint (spec D7): one full agent run on a task, resolving
   with the spec-§3.4 RunSummary on every terminal path — including
   status:"failed", so bench callers keep cost/usage metadata when a run dies.
   Rejects only before a run exists: invalid options, profile load failure, or
   runtime startup failure. */
export const runAgentTask = async (task: string, options: RunAgentTaskOptions = {}): Promise<RunSummary> => {
    if (typeof task !== "string" || task.trim().length === 0) {
        throw new Error("runAgentTask requires a non-empty task.");
    }
    if (options.hitl !== undefined && options.hitl !== "off") {
        throw new Error(`runAgentTask supports only hitl: "off"; got "${String(options.hitl)}".`);
    }
    /* Reject a bad budget at the boundary: the graph treats a non-finite or
       non-positive costBudgetUsd as UNLIMITED (budget.ts), so an unvalidated
       NaN (e.g. Number("oops") from a bench var) would silently disable the
       cost ceiling on a live run instead of failing the caller. */
    if (
        options.budgetUsd !== undefined &&
        (typeof options.budgetUsd !== "number" || !Number.isFinite(options.budgetUsd) || options.budgetUsd <= 0)
    ) {
        throw new Error(
            `runAgentTask requires budgetUsd to be a finite number greater than 0; got "${String(options.budgetUsd)}".`,
        );
    }
    if (options.workspaceDir !== undefined) {
        let stat: ReturnType<typeof statSync>;
        try {
            stat = statSync(options.workspaceDir);
        } catch {
            throw new Error(`runAgentTask workspaceDir does not exist: ${options.workspaceDir}`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`runAgentTask workspaceDir is not a directory: ${options.workspaceDir}`);
        }
    }
    const profile =
        typeof options.profile === "object" ? options.profile : loadProfile(options.profile ?? DEFAULT_PROFILE_NAME);
    const { summary } = await executeAgentRun({
        task: task.trim(),
        profile,
        costBudgetUsd: options.budgetUsd ?? profile.budget?.costBudgetUsd ?? DEFAULT_COST_BUDGET_USD,
        patchApplicationEnabled: options.applyPatches ?? false,
        hitlResolver: autoAbortResolver,
        ...(options.workspaceDir !== undefined ? { workspaceDir: options.workspaceDir } : {}),
        ...(options.tools !== undefined ? { tools: options.tools } : {}),
    });
    return summary;
};
