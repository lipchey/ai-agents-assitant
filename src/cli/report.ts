import { getOutputWriter } from "../logging";
import type { GraphStateValue } from "../state";
import type { OutputWriter } from "../types/logging.ts";

export const printReport = (
    finalState: GraphStateValue,
    costBudgetUsd: number,
    output: OutputWriter = getOutputWriter(),
): void => {
    output.line("=== FINAL ANSWER ===");
    output.line(finalState.finalAnswer || finalState.bestDraft || finalState.currentDraft || "(no final answer)");

    if (finalState.patchReport) {
        output.line("\n=== PATCH APPLICATION ===");
        output.line(finalState.patchReport);
    }

    const budget = finalState.costBudgetUsd || costBudgetUsd;
    const spent = finalState.totalCost || 0;

    output.line("\n=== TELEMETRY REPORT ===");
    output.line(`Total Tokens: ${finalState.totalTokens}`);
    output.line(`Total Cost: $${spent.toFixed(6)}`);
    output.line(`Cost Budget: $${budget.toFixed(2)}`);
    output.line(`Remaining Budget: $${Math.max(0, budget - spent).toFixed(6)}`);
    output.line("Breakdown by Role:");
    for (const [role, stats] of Object.entries(finalState.usageStats)) {
        const cacheDetails = [
            stats.cachedInputTokens ? `${stats.cachedInputTokens} cached input` : "",
            stats.cacheMissInputTokens ? `${stats.cacheMissInputTokens} cache-miss input` : "",
            stats.cacheWriteInputTokens ? `${stats.cacheWriteInputTokens} cache-write input` : "",
        ]
            .filter(Boolean)
            .join(", ");
        output.line(
            `  - ${role}: ${stats.tokens} tokens, $${stats.cost.toFixed(6)}${cacheDetails ? ` (${cacheDetails})` : ""}`,
        );
    }
    output.line("========================");
};
