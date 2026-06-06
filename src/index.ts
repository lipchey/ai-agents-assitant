import "dotenv/config";
import { buildMainGraph } from "./main.js";
import { startOpenClawGateway, stopOpenClawGateway } from "./tools/openclaw.js";

const DEFAULT_COST_BUDGET_USD = 1;

const readCostBudgetUsd = (): number => {
    const configured = Number(process.env.AGENT_COST_BUDGET_USD);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COST_BUDGET_USD;
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
        const finalState = await graph.invoke(
            {
                originalTask: task,
                costBudgetUsd,
            },
            // Headroom above the worst-case bounded flow (~22 super-steps with the
            // context-fetch, debate, and verify caps) so a legitimate multi-cycle
            // run never trips LangGraph's default recursion limit of 25 and throws
            // away all telemetry. The per-cycle caps are the real termination guard.
            { recursionLimit: 50 },
        );

        console.log("=== FINAL ANSWER ===");
        console.log(finalState.finalAnswer || finalState.bestDraft || finalState.currentDraft || "(no final answer)");

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
