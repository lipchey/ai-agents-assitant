import { ModelRole } from "../../consts/models.ts";
import { UsageKey } from "../../consts/usage.ts";
import { SystemPrompts } from "../../prompts/index.ts";
import { usageFromLlm } from "../../shared/usage.ts";
import { callLlm } from "../../tools/openclaw.ts";
import type { GraphStateValue } from "../../types/graph/state.ts";

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
