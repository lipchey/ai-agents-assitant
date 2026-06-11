import { ModelRole, RESPONSE_FORMAT_JSON, UsageKey } from "../../consts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { readProfile, resolveTuning } from "../../models";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import { strongEscalationReasonForTask } from "../escalation.ts";
import { parseFrontierArchitectureDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../state";

export const frontierArchitect = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.FRONTIER,
        SystemPrompts.frontierArchitect,
        [
            `Task:\n${state.originalTask}`,
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ]
            .filter(Boolean)
            .join("\n\n"),
        { maxTokens: 2_400, responseFormat: RESPONSE_FORMAT_JSON },
        config,
    );
    const decision = parseFrontierArchitectureDecision(result.content);
    const deterministicReason = strongEscalationReasonForTask(state.originalTask);
    const strongEscalationRequired =
        Boolean(deterministicReason) ||
        decision.escalateToStrong ||
        decision.confidence < resolveTuning(readProfile(config)).confidenceEscalationThreshold;
    const strongEscalationReason =
        deterministicReason ??
        decision.escalationReason ??
        (strongEscalationRequired ? "Frontier architect requested strong-model escalation." : "");

    return {
        architectureSpec: decision.architectureSpec,
        frontierDraft: decision.architectureSpec,
        frontierConfidence: decision.confidence,
        strongEscalationRequired,
        strongEscalationReason,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.FRONTIER_ARCHITECT]: usageFromLlm(result) },
    };
};

export const claudeArchitect = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.ARCHITECT,
        SystemPrompts.claudeArchitect,
        [
            `Task:\n${state.originalTask}`,
            state.frontierDraft ? `Low-cost frontier draft to verify or improve:\n${state.frontierDraft}` : "",
            state.strongEscalationReason ? `Escalation reason:\n${state.strongEscalationReason}` : "",
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ]
            .filter(Boolean)
            .join("\n\n"),
        {},
        config,
    );

    return {
        architectureSpec: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.ARCHITECT]: usageFromLlm(result) },
    };
};
