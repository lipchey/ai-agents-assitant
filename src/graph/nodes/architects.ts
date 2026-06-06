import { ModelRole, RESPONSE_FORMAT_JSON } from "../../consts/models.ts";
import { CONFIDENCE_ESCALATION_THRESHOLD } from "../../consts/tuning.ts";
import { UsageKey } from "../../consts/usage.ts";
import { SystemPrompts } from "../../prompts.ts";
import { usageFromLlm } from "../../shared/usage.ts";
import { callLlm } from "../../tools/openclaw.ts";
import { strongEscalationReasonForTask } from "../escalation.ts";
import { parseFrontierArchitectureDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../types/graph/state.ts";

export const frontierArchitect = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.FRONTIER,
        SystemPrompts.frontierArchitect,
        [
            `Task:\n${state.originalTask}`,
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
        { maxTokens: 2_400, reasoningEffort: "high", responseFormat: RESPONSE_FORMAT_JSON, thinking: "enabled" },
    );
    const decision = parseFrontierArchitectureDecision(result.content);
    const deterministicReason = strongEscalationReasonForTask(state.originalTask);
    const strongEscalationRequired = Boolean(deterministicReason)
        || decision.escalateToStrong
        || decision.confidence < CONFIDENCE_ESCALATION_THRESHOLD;
    const strongEscalationReason = deterministicReason
        ?? decision.escalationReason
        ?? (strongEscalationRequired ? "Frontier architect requested strong-model escalation." : "");

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

export const claudeArchitect = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.ARCHITECT,
        SystemPrompts.claudeArchitect,
        [
            `Task:\n${state.originalTask}`,
            state.frontierDraft ? `Low-cost frontier draft to verify or improve:\n${state.frontierDraft}` : "",
            state.strongEscalationReason ? `Escalation reason:\n${state.strongEscalationReason}` : "",
            state.compressedContext ? `Compressed context:\n${state.compressedContext}` : "",
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
        { thinking: "adaptive", reasoningEffort: "high" },
    );

    return {
        architectureSpec: result.content,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.ARCHITECT]: usageFromLlm(result) },
    };
};
