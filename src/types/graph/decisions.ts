/* Zod mirrors of the decision JSON contracts (spec D6). Field names are pinned
   three ways at once: the prompt contracts in src/prompts/reasoning-prompts.ts,
   the text parsers in src/graph/parsers.ts / src/swarm/tool-validation.ts, and
   these schemas — change them together (code-guidelines §6). Numeric bounds are
   deliberately NOT enforced here: parse sites clamp/normalize exactly like the
   text path, and a stricter schema would reject an otherwise-usable decision
   into the heuristic fallback. */
import { z } from "zod";
import { GraphComplexity, WorkerKind } from "../../consts";

export const routerDecisionSchema = z.object({
    complexity: z.enum([GraphComplexity.TRIVIAL, GraphComplexity.PURE_REASONING, GraphComplexity.TOOL_COMPLEX]),
    routeConfidence: z.number(),
});

export const frontierArchitectureDecisionSchema = z.object({
    architectureSpec: z.string(),
    confidence: z.number(),
    escalateToStrong: z.boolean(),
    escalationReason: z.string(),
});

export const criticDecisionSchema = z.object({
    consensus: z.boolean(),
    needsMoreContext: z.boolean(),
    critique: z.string(),
});

export const frontierCriticDecisionSchema = criticDecisionSchema.extend({
    confidence: z.number(),
    requiresStrongCritic: z.boolean(),
    escalationReason: z.string(),
});

export const workerKindDecisionSchema = z.object({
    workerKind: z.enum([WorkerKind.CODE_EXPLORER, WorkerKind.INFRA_OPS, WorkerKind.WEB_RESEARCHER]),
});
