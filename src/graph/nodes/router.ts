// Entry node: a cheap LLM pre-filter classifies the task complexity, which sets
// the entire downstream route (direct answer vs pure reasoning vs full swarm).
import { DEFAULT_COST_BUDGET_USD, ModelRole, RESPONSE_FORMAT_JSON, UsageKey } from "../../constants.js";
import { SystemPrompts } from "../../prompts.js";
import { usageFromLlm } from "../../shared/usage.js";
import { callLlm } from "../../tools/openclaw.js";
import { parseRouterDecision } from "../parsers.js";
import type { GraphStateValue } from "../types.js";

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
