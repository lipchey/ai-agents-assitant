import { ModelRole, UsageKey } from "../../consts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import type { GraphStateValue } from "../../state";

export const claudeCoder = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.CODER,
        SystemPrompts.claudeCoder,
        [
            `Spec:\n${state.architectureSpec}`,
            `Critiques to fix:\n${state.debateSummary || "None"}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ]
            .filter(Boolean)
            .join("\n\n"),
        {},
        config,
    );

    return {
        currentDraft: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.CODER]: usageFromLlm(result) },
    };
};
