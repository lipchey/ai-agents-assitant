import { ModelRole } from "../../consts/models.ts";
import { UsageKey } from "../../consts/usage.ts";
import { SystemPrompts } from "../../prompts.ts";
import { usageFromLlm } from "../../shared/usage.ts";
import { callLlm } from "../../tools/openclaw.ts";
import type { GraphStateValue } from "../../types/graph/state.ts";

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
