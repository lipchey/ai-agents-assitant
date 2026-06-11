import { ModelRole, RESPONSE_FORMAT_JSON, DEFAULT_COST_BUDGET_USD, UsageKey } from "../../consts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import { parseRouterDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../state";

export const complexityRouter = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.ROUTER,
        SystemPrompts.complexityRouter,
        state.originalTask,
        { maxTokens: 160, responseFormat: RESPONSE_FORMAT_JSON },
        config,
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
