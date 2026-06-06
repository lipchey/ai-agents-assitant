/* Refetches are targeted from critique terms to avoid paying for repeated inventory. */
import { WorkerKind } from "../consts/worker.ts";
import type { GraphStateValue } from "../types/graph/state.ts";

const MAX_CONTEXT_SEARCH_TERMS = 10;

const CONTEXT_TERM_STOP_WORDS = new Set([
    "about", "after", "agent", "because", "before", "check", "code", "context",
    "critique", "current", "draft", "evidence", "fetch", "find", "frontier",
    "implementation", "latest", "missing", "more", "needs", "original", "project",
    "reason", "repository", "request", "search", "should", "state", "subtask",
    "summary", "targeted", "task", "that", "this", "true", "what", "where",
]);

const extractContextSearchTerms = (text: string): string[] => {
    const terms = new Map<string, number>();
    const matches = text.matchAll(/`([^`]{2,80})`|\b[A-Za-z][A-Za-z0-9_./-]{2,}\b/gu);
    for (const match of matches) {
        const rawTerm = (match[1] ?? match[0]).trim();
        const normalized = rawTerm.replace(/^["'([{]+|["')\]}.,:;]+$/gu, "");
        const lower = normalized.toLowerCase();
        if (normalized.length < 3 || CONTEXT_TERM_STOP_WORDS.has(lower) || /^\d+$/u.test(normalized)) {
            continue;
        }
        const score = (/[A-Z_./-]/u.test(normalized) ? 2 : 1) + Math.min(3, Math.floor(normalized.length / 12));
        terms.set(normalized, Math.max(terms.get(normalized) ?? 0, score));
    }

    return [...terms.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, MAX_CONTEXT_SEARCH_TERMS)
        .map(([term]) => term);
};

export const buildSwarmSubtask = (state: GraphStateValue): string => {
    if (state.needsMoreContext && (state.debateSummary || state.debateThread.length > 0)) {
        const latestCritique = state.debateThread.at(-1)?.critique;
        const critiqueContext = [
            state.debateSummary ? `Debate summary:\n${state.debateSummary}` : "",
            latestCritique ? `Latest critique:\n${latestCritique}` : "",
        ].filter(Boolean).join("\n\n");
        const searchTerms = extractContextSearchTerms(critiqueContext);
        return [
            "Targeted context request for repository inspection.",
            `Original task:\n${state.originalTask}`,
            "Critique/debate summary that triggered needsMoreContext=true:",
            critiqueContext,
            searchTerms.length > 0 ? `Search focus terms: ${searchTerms.join(", ")}` : "",
            "Return only evidence that directly resolves this missing context. Avoid repeating broad repository inventory unless the critique requires it.",
        ].filter(Boolean).join("\n\n");
    }
    return state.originalTask;
};

export const selectWorkerKind = (task: string): WorkerKind => {
    const normalized = task.toLowerCase();
    if (/\b(latest|docs|documentation|web|internet|search|browse|research)\b/u.test(normalized)) {
        return WorkerKind.WEB_RESEARCHER;
    }
    if (/\b(test|build|compile|tsc|npm|shell|command|docker|infra)\b/u.test(normalized)) {
        return WorkerKind.INFRA_OPS;
    }
    return WorkerKind.CODE_EXPLORER;
};
