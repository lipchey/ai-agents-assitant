import "dotenv/config";
import {
    buildHitlResolver,
    loadActiveProfile,
    readCostBudgetUsd,
    readPatchApplicationEnabled,
    printReport,
} from "./cli";
import {
    HITL_RESOLVER_CONFIG_KEY,
    MAIN_GRAPH_RECURSION_LIMIT,
    PROFILE_CONFIG_KEY,
    TOOL_REGISTRY_CONFIG_KEY,
} from "./consts";
import { buildMainGraph } from "./graph";
import { getLogger, getOutputWriter } from "./logging";
import { getDefaultToolRegistry, startOpenClawGateway, stopOpenClawGateway } from "./tools";

const run = async (): Promise<void> => {
    const logger = getLogger().child({ module: "main" });
    const output = getOutputWriter();
    const task = process.argv.slice(2).join(" ").trim();
    if (!task) {
        output.errorLine('Usage: npm start -- "<your task description>"');
        process.exit(1);
    }

    /* One shared registry: the same instance the compatibility seams and DI fallbacks resolve to. */
    const tools = getDefaultToolRegistry();

    logger.info("Ensuring OpenClaw Gateway is running.");
    try {
        await startOpenClawGateway();
        await tools.start();
        logger.info("Gateway ready. Starting agent.", { taskPreview: task });
    } catch (error) {
        logger.error("Failed to start OpenClaw Gateway.", { error });
        process.exit(1);
    }

    try {
        const graph = buildMainGraph();
        const profile = loadActiveProfile();
        const costBudgetUsd = readCostBudgetUsd(profile.budget?.costBudgetUsd);
        const patchApplicationEnabled = readPatchApplicationEnabled();
        if (patchApplicationEnabled) {
            logger.info("Patch application enabled; verified changes will be written to the repository.");
        }
        logger.info("Active profile resolved.", { profile: profile.name, costBudgetUsd });
        const finalState = await graph.invoke(
            { originalTask: task, costBudgetUsd, patchApplicationEnabled },
            /* Keep the non-serializable HITL resolver and profile out of checkpointed graph state. */
            {
                recursionLimit: MAIN_GRAPH_RECURSION_LIMIT,
                configurable: {
                    [HITL_RESOLVER_CONFIG_KEY]: buildHitlResolver(),
                    [TOOL_REGISTRY_CONFIG_KEY]: tools,
                    [PROFILE_CONFIG_KEY]: profile,
                },
            },
        );

        printReport(finalState, costBudgetUsd, output);
    } catch (error) {
        logger.error("Agent execution failed.", { error });
        process.exitCode = 1;
    } finally {
        await tools.stop();
        await stopOpenClawGateway();
    }
};

void run();
