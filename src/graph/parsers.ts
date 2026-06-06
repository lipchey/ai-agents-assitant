/* Malformed model JSON degrades to heuristics instead of crashing the graph. */
import { CONFIDENCE_ESCALATION_THRESHOLD } from "../consts/tuning.ts";
import { asRecord, extractJsonObject } from "../shared/json.ts";
import { clamp01 } from "../shared/text.ts";
import type {
    CriticDecision,
    FrontierArchitectureDecision,
    FrontierCriticDecision,
    RouterDecision,
} from "../types/graph/parsers.ts";

const heuristicComplexity = (task: string): RouterDecision => {
    const normalized = task.toLowerCase();
    const toolSignals = ["project", "repo", "code", "bug", "fix", "test", "openclaw", "typescript", "langgraph", "file", "implementation"];
    const reasoningSignals = ["explain", "design", "architecture", "compare", "plan"];

    if (toolSignals.some((signal) => normalized.includes(signal))) {
        return { complexity: "tool_complex", routeConfidence: 0.75 };
    }
    if (reasoningSignals.some((signal) => normalized.includes(signal))) {
        return { complexity: "pure_reasoning", routeConfidence: 0.65 };
    }
    return { complexity: "trivial", routeConfidence: 0.6 };
};

export const parseRouterDecision = (content: string, task: string): RouterDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const complexity = parsed?.complexity;
    const confidence = parsed?.routeConfidence;

    if (
        (complexity === "trivial" || complexity === "tool_complex" || complexity === "pure_reasoning")
        && typeof confidence === "number"
    ) {
        return { complexity, routeConfidence: clamp01(confidence) };
    }
    return heuristicComplexity(task);
};

export const parseCriticDecision = (content: string): CriticDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const consensus = typeof parsed?.consensus === "boolean" ? parsed.consensus : /\bLGTM\b|approved|looks good/iu.test(content);
    const needsMoreContext = typeof parsed?.needsMoreContext === "boolean" ? parsed.needsMoreContext : /need(s)? more context|missing context/iu.test(content);
    const critique = typeof parsed?.critique === "string" ? parsed.critique : content;
    return { consensus, needsMoreContext, critique };
};

export const parseFrontierArchitectureDecision = (content: string): FrontierArchitectureDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const architectureSpec = typeof parsed?.architectureSpec === "string" && parsed.architectureSpec.trim()
        ? parsed.architectureSpec.trim()
        : content;
    const confidence = typeof parsed?.confidence === "number" ? clamp01(parsed.confidence) : 0.55;
    const escalateToStrong = typeof parsed?.escalateToStrong === "boolean"
        ? parsed.escalateToStrong
        : confidence < CONFIDENCE_ESCALATION_THRESHOLD;
    const escalationReason = typeof parsed?.escalationReason === "string" && parsed.escalationReason.trim()
        ? parsed.escalationReason.trim()
        : confidence < CONFIDENCE_ESCALATION_THRESHOLD
            ? `Frontier architect confidence below ${CONFIDENCE_ESCALATION_THRESHOLD}.`
            : "";

    return { architectureSpec, confidence, escalateToStrong, escalationReason };
};

export const parseFrontierCriticDecision = (content: string): FrontierCriticDecision => {
    const parsed = asRecord(extractJsonObject(content));
    const baseDecision = parseCriticDecision(content);
    const confidence = typeof parsed?.confidence === "number" ? clamp01(parsed.confidence) : 0.55;
    const requiresStrongCritic = typeof parsed?.requiresStrongCritic === "boolean"
        ? parsed.requiresStrongCritic
        : confidence < CONFIDENCE_ESCALATION_THRESHOLD;
    const escalationReason = typeof parsed?.escalationReason === "string" && parsed.escalationReason.trim()
        ? parsed.escalationReason.trim()
        : confidence < CONFIDENCE_ESCALATION_THRESHOLD
            ? `Frontier critic confidence below ${CONFIDENCE_ESCALATION_THRESHOLD}.`
            : "";

    return { ...baseDecision, confidence, requiresStrongCritic, escalationReason };
};

export const extractToolStatus = (report: Record<string, unknown>): { status: string; exitCode?: number } => {
    const details = asRecord(report.details);
    const status = typeof details?.status === "string"
        ? details.status
        : typeof report.status === "string"
            ? report.status
            : "";
    const exitCode = typeof details?.exitCode === "number"
        ? details.exitCode
        : typeof report.exitCode === "number"
            ? report.exitCode
            : undefined;
    return exitCode === undefined ? { status } : { status, exitCode };
};
