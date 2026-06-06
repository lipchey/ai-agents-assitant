import "dotenv/config";
import { buildHitlResolver, readCostBudgetUsd, readPatchApplicationEnabled } from "./cli/config.js";
import { printReport } from "./cli/report.js";
import { HITL_RESOLVER_CONFIG_KEY } from "./hitl.js";
import { buildMainGraph } from "./main.js";
import { startOpenClawGateway, stopOpenClawGateway } from "./tools/openclaw.js";

// Headroom above the worst-case bounded flow (~22 super-steps with the
// context-fetch, debate, and verify caps) so a legitimate multi-cycle run never
// trips LangGraph's default recursion limit of 25 and throws away telemetry. The
// per-cycle caps are the real termination guard.
const RECURSION_LIMIT = 50;

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
            // `hitlResolver` reaches the swarmNode via config (not graph state) so the
            // non-serializable resolver function never enters a checkpoint.
            { recursionLimit: RECURSION_LIMIT, configurable: { [HITL_RESOLVER_CONFIG_KEY]: buildHitlResolver() } },
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
