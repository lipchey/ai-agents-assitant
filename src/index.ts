import "dotenv/config";
import { buildMainGraph } from "./main.js";
import { startOpenClawGateway, stopOpenClawGateway } from "./tools/openclaw.js";

async function run() {
    const task = process.argv[2];
    if (!task) {
        console.error("Usage: npm start \"<your task description>\"");
        process.exit(1);
    }

    console.log(`Starting OpenClaw Gateway...`);
    try {
        await startOpenClawGateway();
        console.log(`Gateway started. Starting agent with task: "${task}"\n`);
    } catch (e: any) {
        console.error("Failed to start gateway:", e.message);
        process.exit(1);
    }
    
    try {
        const graph = buildMainGraph();
        
        // Execute graph
        const stream = await graph.stream({
            originalTask: task,
            tokenBudget: 100
        });

        let finalState: any = null;
        for await (const state of stream) {
            const nodeName = Object.keys(state)[0];
            if (!nodeName) continue;
            console.log(`--- [Node: ${nodeName}] ---`);
            // Print brief state summary
            const stateData = (state as any)[nodeName];
            finalState = stateData; // Keep track of the latest state for telemetry
            
            if (stateData.complexity) console.log(`Complexity: ${stateData.complexity}`);
            if (stateData.currentDraft) console.log(`Draft updated (length: ${stateData.currentDraft.length})`);
            if (stateData.finalAnswer) console.log(`Final Answer: \n${stateData.finalAnswer}`);
            if (stateData.error) console.log(`Error: ${stateData.error}`);
            console.log("-----------------------\n");
        }

        console.log("Graph execution completed successfully.");
        
        if (finalState && finalState.usageStats) {
            console.log("\n=== TELEMETRY REPORT ===");
            console.log(`Total Tokens: ${finalState.totalTokens}`);
            console.log(`Total Cost: $${(finalState.totalCost || 0).toFixed(6)}`);
            console.log("Breakdown by Role:");
            for (const [role, stats] of Object.entries(finalState.usageStats)) {
                const castedStats = stats as { tokens: number; cost: number };
                console.log(`  - ${role}: ${castedStats.tokens} tokens, $${castedStats.cost.toFixed(6)}`);
            }
            console.log("========================\n");
        }
        
    } catch (e: any) {
        console.error("Agent execution failed:", e.message);
    } finally {
        console.log("Stopping OpenClaw Gateway...");
        stopOpenClawGateway();
    }
}

run();
