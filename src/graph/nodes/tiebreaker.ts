// Deadlock breaker: invoked only when the debate hits its iteration cap without
// consensus. Produces the single best corrected draft and ends the debate.
import { ModelRole, UsageKey } from "../../constants.js";
import { SystemPrompts } from "../../prompts.js";
import { usageFromLlm } from "../../shared/usage.js";
import { callLlm } from "../../tools/openclaw.js";
import type { GraphStateValue } from "../types.js";

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
