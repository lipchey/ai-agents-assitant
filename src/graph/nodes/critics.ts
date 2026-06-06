import {
    ModelRole,
    RESPONSE_FORMAT_JSON,
    CONFIDENCE_ESCALATION_THRESHOLD,
    RECENT_DEBATE_WINDOW,
    ReasoningEffort,
    ThinkingMode,
    UsageKey,
} from "../../consts";
import { SystemPrompts } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import { strongEscalationReasonForTask } from "../escalation.ts";
import { parseCriticDecision, parseFrontierCriticDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../types/graph";

export const frontierCritic = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.FRONTIER,
        SystemPrompts.frontierCritic,
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-RECENT_DEBATE_WINDOW))}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ].filter(Boolean).join("\n\n"),
        {
            maxTokens: 1_400,
            reasoningEffort: ReasoningEffort.HIGH,
            responseFormat: RESPONSE_FORMAT_JSON,
            thinking: ThinkingMode.ENABLED,
        },
    );
    const decision = parseFrontierCriticDecision(result.content);
    const deterministicReason = strongEscalationReasonForTask(state.originalTask);
    const strongCriticRequired = Boolean(deterministicReason)
        || decision.requiresStrongCritic
        || decision.confidence < CONFIDENCE_ESCALATION_THRESHOLD;
    const criticEscalationReason = deterministicReason
        ?? decision.escalationReason
        ?? (strongCriticRequired ? "Frontier critic requested strong-model review." : "");

    return {
        debateThread: [{ round: state.debateIterations, critique: `[frontier] ${decision.critique}` }],
        debateSummary: decision.critique,
        debateIterations: state.debateIterations + 1,
        consensusReached: decision.consensus,
        needsMoreContext: decision.needsMoreContext,
        criticConfidence: decision.confidence,
        strongCriticRequired,
        criticEscalationReason,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.FRONTIER_CRITIC]: usageFromLlm(result) },
    };
};

export const openaiCritic = async (state: GraphStateValue) => {
    const result = await callLlm(
        ModelRole.CRITIC,
        SystemPrompts.openaiCritic,
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            state.criticEscalationReason ? `Frontier critic escalation reason:\n${state.criticEscalationReason}` : "",
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-RECENT_DEBATE_WINDOW))}`,
        ].filter(Boolean).join("\n\n"),
        { maxTokens: 1_400, responseFormat: RESPONSE_FORMAT_JSON },
    );
    const decision = parseCriticDecision(result.content);
    /* Frontier critic already counted this escalated round. */
    const frontierAlreadyCounted = state.strongCriticRequired;
    const debateRound = frontierAlreadyCounted ? Math.max(0, state.debateIterations - 1) : state.debateIterations;

    return {
        debateThread: [{ round: debateRound, critique: `[strong] ${decision.critique}` }],
        debateSummary: decision.critique,
        debateIterations: state.debateIterations + (frontierAlreadyCounted ? 0 : 1),
        consensusReached: decision.consensus,
        needsMoreContext: decision.needsMoreContext,
        strongCriticRequired: false,
        totalCost: result.cost,
        totalTokens: result.tokens,
        usageStats: { [UsageKey.CRITIC]: usageFromLlm(result) },
    };
};
