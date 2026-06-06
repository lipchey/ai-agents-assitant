// Critic nodes controlling the debate loop. The frontier critic reviews first and
// gates strong-critic escalation; the GPT critic runs only when escalated.
import { CONFIDENCE_ESCALATION_THRESHOLD, ModelRole, RESPONSE_FORMAT_JSON, UsageKey } from "../../constants.js";
import { SystemPrompts } from "../../prompts.js";
import { usageFromLlm } from "../../shared/usage.js";
import { callLlm } from "../../tools/openclaw.js";
import { strongEscalationReasonForTask } from "../escalation.js";
import { parseCriticDecision, parseFrontierCriticDecision } from "../parsers.js";
import type { GraphStateValue } from "../types.js";

const RECENT_DEBATE_WINDOW = 3;

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
        { maxTokens: 1_400, reasoningEffort: "high", responseFormat: RESPONSE_FORMAT_JSON, thinking: "enabled" },
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
    // The frontier critic already counted this debate round when it escalated, so
    // don't double-count it here.
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
