import "dotenv/config";
import { buildMainGraph } from "./main.js";

async function run() {
    const task = process.argv[2];
    if (!task) {
        console.error("Usage: npm start \"<your task description>\"");
        process.exit(1);
    }

    console.log(`Starting agent with task: "${task}"\n`);
    
    try {
        const graph = buildMainGraph();
        
        // Execute graph
        const stream = await graph.stream({
            originalTask: task,
            tokenBudget: 100
        });

        for await (const state of stream) {
            const nodeName = Object.keys(state)[0];
            if (!nodeName) continue;
            console.log(`--- [Node: ${nodeName}] ---`);
            // Print brief state summary
            const stateData = (state as any)[nodeName];
            if (stateData.complexity) console.log(`Complexity: ${stateData.complexity}`);
            if (stateData.currentDraft) console.log(`Draft updated (length: ${stateData.currentDraft.length})`);
            if (stateData.finalAnswer) console.log(`Final Answer: \n${stateData.finalAnswer}`);
            if (stateData.error) console.log(`Error: ${stateData.error}`);
            console.log("-----------------------\n");
        }

        console.log("Graph execution completed successfully.");
    } catch (e: any) {
        console.error("Agent execution failed:", e.message);
    }
}

run();
