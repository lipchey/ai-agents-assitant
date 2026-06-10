import { ModelRole, ThinkingMode, UsageKey } from "../../consts";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import type { GraphStateValue } from "../../types/graph";

export const directResponder = async (state: GraphStateValue) => {
    const result = await callLlm(ModelRole.ROUTER, SystemPrompts.directResponder, state.originalTask, {
        maxTokens: 800,
        thinking: ThinkingMode.DISABLED,
    });
    return {
        currentDraft: result.content,
        bestDraft: result.content,
        consensusReached: true,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.DIRECT]: usageFromLlm(result) },
    };
};
