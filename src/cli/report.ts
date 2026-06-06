import type { GraphStateValue } from "../graph/types.js";

export const printReport = (finalState: GraphStateValue, costBudgetUsd: number): void => {
    console.log("=== FINAL ANSWER ===");
    console.log(finalState.finalAnswer || finalState.bestDraft || finalState.currentDraft || "(no final answer)");

    if (finalState.patchReport) {
        console.log("\n=== PATCH APPLICATION ===");
        console.log(finalState.patchReport);
    }

    const budget = finalState.costBudgetUsd || costBudgetUsd;
    const spent = finalState.totalCost || 0;

    console.log("\n=== TELEMETRY REPORT ===");
    console.log(`Total Tokens: ${finalState.totalTokens}`);
    console.log(`Total Cost: $${spent.toFixed(6)}`);
    console.log(`Cost Budget: $${budget.toFixed(2)}`);
    console.log(`Remaining Budget: $${Math.max(0, budget - spent).toFixed(6)}`);
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
};
