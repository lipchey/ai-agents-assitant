import { ModelRole } from "../../consts/models.js";
import { UsageKey } from "../../consts/usage.js";
import { SystemPrompts } from "../../prompts.js";
import { usageFromLlm } from "../../shared/usage.js";
import { callLlm } from "../../tools/openclaw.js";
import type { GraphStateValue } from "../../types/graph/state.js";

export const claudeCoder = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.CODER,
        SystemPrompts.claudeCoder,
        [
            `Spec:\n${state.architectureSpec}`,
            `Critiques to fix:\n${state.debateSummary || "None"}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
    );

    return {
        currentDraft: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.CODER]: usageFromLlm(result) },
    };
};
