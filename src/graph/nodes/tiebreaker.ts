import { ModelRole, UsageKey } from "../../consts";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import type { GraphStateValue } from "../../types/graph";

export const smeTiebreaker = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.SME,
        SystemPrompts.smeTiebreaker,
        [
            `Task:\n${state.originalTask}`,
            `Current draft:\n${state.currentDraft}`,
            `Debate summary:\n${state.debateSummary}`,
        ].join("\n\n"),
        { thinking: "adaptive", reasoningEffort: "high" },
    );
    return {
        currentDraft: result.content,
        consensusReached: true,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.SME]: usageFromLlm(result) },
    };
};
