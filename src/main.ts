import "dotenv/config";
import { buildHitlResolver, readCostBudgetUsd, readPatchApplicationEnabled, printReport } from "./cli";
import { HITL_RESOLVER_CONFIG_KEY, MAIN_GRAPH_RECURSION_LIMIT } from "./consts";
import { buildMainGraph } from "./graph";
import { startOpenClawGateway, stopOpenClawGateway } from "./tools";

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
        console.error("Failed to start OpenClaw Gateway:", error instanceof Error ? error.message : String(error));
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
            { originalTask: task, costBudgetUsd, patchApplicationEnabled },
            /* Keep the non-serializable HITL resolver out of checkpointed graph state. */
            { recursionLimit: MAIN_GRAPH_RECURSION_LIMIT, configurable: { [HITL_RESOLVER_CONFIG_KEY]: buildHitlResolver() } },
        );

        printReport(finalState, costBudgetUsd);
    } catch (error) {
        console.error("Agent execution failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    } finally {
        await stopOpenClawGateway();
    }
};

void run();
