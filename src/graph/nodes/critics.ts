import { ModelRole, RESPONSE_FORMAT_JSON, RECENT_DEBATE_WINDOW, UsageKey } from "../../consts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { readProfile, resolveTuning } from "../../models";
import { promptsForConfig } from "../../prompts";
import { usageFromLlm } from "../../shared";
import { callLlm } from "../../tools";
import { criticDecisionSchema, frontierCriticDecisionSchema } from "../../types/graph";
import { strongEscalationReasonForTask } from "../escalation.ts";
import { parseCriticDecision, parseFrontierCriticDecision } from "../parsers.ts";
import type { GraphStateValue } from "../../state";

export const frontierCritic = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.REASONER,
        promptsForConfig(config).frontierCritic,
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-RECENT_DEBATE_WINDOW))}`,
            state.verificationReport ? `Verification feedback:\n${state.verificationReport}` : "",
        ]
            .filter(Boolean)
            .join("\n\n"),
        { maxTokens: 1_400, responseFormat: RESPONSE_FORMAT_JSON, structuredSchema: frontierCriticDecisionSchema },
        config,
    );
    const decision = parseFrontierCriticDecision(result.content, result.parsed);
    const deterministicReason = strongEscalationReasonForTask(state.originalTask);
    const strongCriticRequired =
        Boolean(deterministicReason) ||
        decision.requiresStrongCritic ||
        decision.confidence < resolveTuning(readProfile(config)).confidenceEscalationThreshold;
    const criticEscalationReason =
        deterministicReason ??
        decision.escalationReason ??
        (strongCriticRequired ? "Frontier critic requested strong-model review." : "");

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

export const openaiCritic = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const result = await callLlm(
        ModelRole.CRITIC,
        promptsForConfig(config).openaiCritic,
        [
            `Task:\n${state.originalTask}`,
            `Draft:\n${state.currentDraft}`,
            state.criticEscalationReason ? `Frontier critic escalation reason:\n${state.criticEscalationReason}` : "",
            `Debate so far:\n${JSON.stringify(state.debateThread.slice(-RECENT_DEBATE_WINDOW))}`,
        ]
            .filter(Boolean)
            .join("\n\n"),
        { maxTokens: 1_400, responseFormat: RESPONSE_FORMAT_JSON, structuredSchema: criticDecisionSchema },
        config,
    );
    const decision = parseCriticDecision(result.content, result.parsed);
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
