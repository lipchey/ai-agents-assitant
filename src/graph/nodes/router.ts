import { ModelRole, RESPONSE_FORMAT_JSON } from "../../consts/models.ts";
import { DEFAULT_COST_BUDGET_USD } from "../../consts/tuning.ts";
import { UsageKey } from "../../consts/usage.ts";
import { SystemPrompts } from "../../prompts.ts";
import { usageFromLlm } from "../../shared/usage.ts";
import { callLlm } from "../../tools/openclaw.ts";
import { parseRouterDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../types/graph/state.ts";

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
