import { ModelRole, UsageKey } from "../../consts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import type { GraphStateValue } from "../../state";

export const directResponder = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.ROUTER,
        SystemPrompts.directResponder,
        state.originalTask,
        { maxTokens: 800 },
        config,
    );
    return {
        currentDraft: result.content,
        bestDraft: result.content,
        consensusReached: true,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.DIRECT]: usageFromLlm(result) },
    };
};
