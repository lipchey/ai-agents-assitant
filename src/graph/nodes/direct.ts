import { ModelRole } from "../../consts/models.ts";
import { UsageKey } from "../../consts/usage.ts";
import { SystemPrompts } from "../../prompts/index.ts";
import { usageFromLlm } from "../../shared/usage.ts";
import { callLlm } from "../../tools/openclaw.ts";
import type { GraphStateValue } from "../../types/graph/state.ts";

export const directResponder = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.ROUTER,
        SystemPrompts.directResponder,
        state.originalTask,
        { maxTokens: 800, thinking: "disabled" },
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
