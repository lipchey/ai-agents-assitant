import "dotenv/config";
import {
    autoAbortResolver,
    createStdinHitlResolver,
    HITL_RESOLVER_CONFIG_KEY,
    type HitlResolver,
} from "./hitl.js";
import { buildMainGraph } from "./main.js";
import { startOpenClawGateway, stopOpenClawGateway } from "./tools/openclaw.js";

const DEFAULT_COST_BUDGET_USD = 1;

const readCostBudgetUsd = (): number => {
    const configured = Number(process.env.AGENT_COST_BUDGET_USD);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_BUDGET_USD;
};

// Human-in-the-loop is ON by default and prompts on the terminal for swarm
// environment failures; on a non-TTY it degrades to graceful auto-abort. Set
// AGENT_HITL to a falsey value to force auto-abort even in an interactive shell.
const buildHitlResolver = (): HitlResolver => {
    const raw = process.env.AGENT_HITL?.trim();
    if (raw && !/^(1|true|yes|on)$/iu.test(raw)) {
        return autoAbortResolver;
    }
    return createStdinHitlResolver();
};

// Autonomous file mutation is OFF unless explicitly opted into. When enabled the
// `applyPatches` stage writes the coder's structured patch blocks to disk and
// reverts them if verification ultimately fails.
const readPatchApplicationEnabled = (): boolean => {
    return /^(1|true|yes|on)$/iu.test(process.env.AGENT_APPLY_PATCHES?.trim() ?? "");
};

const run = async (): Promise<void> => {
    const task = process.argv.slice(2).join(" ").trim();
    if (!task) {
        console.error('Usage: npm start -- "<your task description>"');
        process.exit(1);
    }

    console.log("Ensuring OpenClaw Gateway is running...");
    try {
        await startOpenClawGateway();
        console.log(`Gateway ready. Starting agent with task: "${task}"\n`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to start OpenClaw Gateway:", message);
        process.exit(1);
    }

    try {
        const graph = buildMainGraph();
        const costBudgetUsd = readCostBudgetUsd();
        const patchApplicationEnabled = readPatchApplicationEnabled();
        if (patchApplicationEnabled) {
            console.log("Patch application ENABLED: verified changes will be written to the repository.\n");
        }
        const finalState = await graph.invoke(
            {
                originalTask: task,
                costBudgetUsd,
                patchApplicationEnabled,
            },
            // Headroom above the worst-case bounded flow (~22 super-steps with the
            // context-fetch, debate, and verify caps) so a legitimate multi-cycle
            // run never trips LangGraph's default recursion limit of 25 and throws
            // away all telemetry. The per-cycle caps are the real termination guard.
            // `hitlResolver` reaches the swarmNode via config (not graph state) so
            // the non-serializable resolver function never enters a checkpoint.
            {
                recursionLimit: 50,
                configurable: { [HITL_RESOLVER_CONFIG_KEY]: buildHitlResolver() },
            },
        );

        console.log("=== FINAL ANSWER ===");
        console.log(finalState.finalAnswer || finalState.bestDraft || finalState.currentDraft || "(no final answer)");

        if (finalState.patchReport) {
            console.log("\n=== PATCH APPLICATION ===");
            console.log(finalState.patchReport);
        }

        console.log("\n=== TELEMETRY REPORT ===");
        console.log(`Total Tokens: ${finalState.totalTokens}`);
        console.log(`Total Cost: $${(finalState.totalCost || 0).toFixed(6)}`);
        console.log(`Cost Budget: $${(finalState.costBudgetUsd || costBudgetUsd).toFixed(2)}`);
        console.log(`Remaining Budget: $${Math.max(0, (finalState.costBudgetUsd || costBudgetUsd) - (finalState.totalCost || 0)).toFixed(6)}`);
        console.log("Breakdown by Role:");
        for (const [role, stats] of Object.entries(finalState.usageStats)) {
            const cacheDetails = [
                stats.cachedInputTokens ? `${stats.cachedInputTokens} cached input` : "",
                stats.cacheMissInputTokens ? `${stats.cacheMissInputTokens} cache-miss input` : "",
                stats.cacheWriteInputTokens ? `${stats.cacheWriteInputTokens} cache-write input` : "",
            ].filter(Boolean).join(", ");
            console.log(`  - ${role}: ${stats.tokens} tokens, $${stats.cost.toFixed(6)}${cacheDetails ? ` (${cacheDetails})` : ""}`);
        }
        console.log("========================");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Agent execution failed:", message);
        process.exitCode = 1;
    } finally {
        await stopOpenClawGateway();
    }
};

void run();
