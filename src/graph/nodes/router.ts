import { ModelRole, RESPONSE_FORMAT_JSON, DEFAULT_COST_BUDGET_USD, UsageKey } from "../../consts";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import { parseRouterDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../types/graph";

export const complexityRouter = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.ROUTER,
        SystemPrompts.complexityRouter,
        state.originalTask,
        { maxTokens: 160, responseFormat: RESPONSE_FORMAT_JSON, thinking: "disabled" },
    );
    const decision = parseRouterDecision(result.content, state.originalTask);

    return {
        complexity: decision.complexity,
        routeConfidence: decision.routeConfidence,
        costBudgetUsd: state.costBudgetUsd ?? DEFAULT_COST_BUDGET_USD,
        debateIterations: 0,
        consensusReached: false,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.ROUTER]: usageFromLlm(result) },
    };
};
