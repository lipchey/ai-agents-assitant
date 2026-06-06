import "dotenv/config";
import { buildMainGraph } from "./main.js";
import { startOpenClawGateway, stopOpenClawGateway } from "./tools/openclaw.js";

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
        const finalState = await graph.invoke(
            {
                originalTask: task,
                tokenBudget: 100,
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
        console.log("Breakdown by Role:");
        for (const [role, stats] of Object.entries(finalState.usageStats)) {
            console.log(`  - ${role}: ${stats.tokens} tokens, $${stats.cost.toFixed(6)}`);
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
