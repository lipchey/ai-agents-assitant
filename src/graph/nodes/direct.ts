import { ModelRole } from "../../consts/models.js";
import { UsageKey } from "../../consts/usage.js";
import { SystemPrompts } from "../../prompts.js";
import { usageFromLlm } from "../../shared/usage.js";
import { callLlm } from "../../tools/openclaw.js";
import type { GraphStateValue } from "../../types/graph/state.js";

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
