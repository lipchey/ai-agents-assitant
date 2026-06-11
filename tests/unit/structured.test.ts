import { describe, it, expect } from "vitest";
import {
    criticDecisionSchema,
    frontierArchitectureDecisionSchema,
    frontierCriticDecisionSchema,
    routerDecisionSchema,
    workerKindDecisionSchema,
} from "../../src/types/graph/decisions.ts";
import {
    parseCriticDecision,
    parseFrontierArchitectureDecision,
    parseFrontierCriticDecision,
    parseRouterDecision,
} from "../../src/graph/parsers.ts";
import { parseWorkerKind } from "../../src/swarm/tool-validation.ts";
import { GraphComplexity } from "../../src/consts/graph.ts";
import { WorkerKind } from "../../src/consts/worker.ts";
import { DEFAULT_CASCADE_NOTE, reasoningPrompts, reasoningPromptsFor } from "../../src/prompts";

/*
 * R5 structured-output coverage: the zod schemas must accept the same
 * well-formed decision objects the R1 parser fixtures pin, and every parse
 * site must prefer a pre-parsed structured object over text extraction while
 * keeping the text ladder as the fallback.
 */

describe("decision schemas accept the R1 fixture shapes", () => {
    it("router: the happy parser fixture validates", () => {
        expect(routerDecisionSchema.safeParse({ complexity: "pure_reasoning", routeConfidence: 0.9 }).success).toBe(
            true,
        );
    });

    it("router: out-of-range confidence is accepted (parse sites clamp, like the text rung)", () => {
        expect(routerDecisionSchema.safeParse({ complexity: "tool_complex", routeConfidence: 1.5 }).success).toBe(true);
    });

    it("router: unknown complexity is rejected", () => {
        expect(routerDecisionSchema.safeParse({ complexity: "wizardry", routeConfidence: 0.9 }).success).toBe(false);
    });

    it("router: string confidence is rejected", () => {
        expect(routerDecisionSchema.safeParse({ complexity: "trivial", routeConfidence: "0.9" }).success).toBe(false);
    });

    it("critic: the happy parser fixture validates", () => {
        expect(
            criticDecisionSchema.safeParse({ consensus: true, needsMoreContext: false, critique: "all good" }).success,
        ).toBe(true);
    });

    it("critic: a missing field is rejected", () => {
        expect(criticDecisionSchema.safeParse({ critique: "some critique" }).success).toBe(false);
    });

    it("architect: the prompt-contract shape validates", () => {
        expect(
            frontierArchitectureDecisionSchema.safeParse({
                architectureSpec: "spec",
                confidence: 0.8,
                escalateToStrong: false,
                escalationReason: "",
            }).success,
        ).toBe(true);
    });

    it("frontier critic: the prompt-contract shape validates", () => {
        expect(
            frontierCriticDecisionSchema.safeParse({
                consensus: false,
                needsMoreContext: false,
                requiresStrongCritic: true,
                confidence: 0.4,
                critique: "needs work",
                escalationReason: "high risk",
            }).success,
        ).toBe(true);
    });

    it("worker kind: every WorkerKind value validates", () => {
        for (const workerKind of Object.values(WorkerKind)) {
            expect(workerKindDecisionSchema.safeParse({ workerKind }).success).toBe(true);
        }
    });

    it("worker kind: casing is strict at the schema layer (text rung lowercases)", () => {
        expect(workerKindDecisionSchema.safeParse({ workerKind: "Code_Explorer" }).success).toBe(false);
    });
});

describe("parse-site precedence: parsed beats text, text stays the fallback", () => {
    it("router: a parsed object wins over malformed text", () => {
        expect(
            parseRouterDecision("garbage {", "fix the bug", { complexity: "trivial", routeConfidence: 0.9 }),
        ).toEqual({ complexity: GraphComplexity.TRIVIAL, routeConfidence: 0.9 });
    });

    it("router: a parsed object wins over conflicting text JSON", () => {
        expect(
            parseRouterDecision('{"complexity":"tool_complex","routeConfidence":0.2}', "irrelevant", {
                complexity: "trivial",
                routeConfidence: 0.9,
            }),
        ).toEqual({ complexity: GraphComplexity.TRIVIAL, routeConfidence: 0.9 });
    });

    it("router: parsed confidence is clamped like the text rung", () => {
        expect(
            parseRouterDecision("garbage", "irrelevant", { complexity: "tool_complex", routeConfidence: 1.5 }),
        ).toEqual({ complexity: GraphComplexity.TOOL_COMPLEX, routeConfidence: 1 });
    });

    it("router: a null parsed value falls back to the text ladder", () => {
        expect(parseRouterDecision('{"complexity":"trivial","routeConfidence":0.5}', "irrelevant", null)).toEqual({
            complexity: GraphComplexity.TRIVIAL,
            routeConfidence: 0.5,
        });
    });

    it("router: an invalid parsed record falls through to the heuristic, not the text", () => {
        expect(parseRouterDecision("no json here", "fix the bug", { complexity: "wizardry" })).toEqual({
            complexity: GraphComplexity.TOOL_COMPLEX,
            routeConfidence: 0.75,
        });
    });

    it("critic: a parsed object wins over approval prose", () => {
        expect(
            parseCriticDecision("This LGTM to me.", { consensus: false, needsMoreContext: true, critique: "redo" }),
        ).toEqual({ consensus: false, needsMoreContext: true, critique: "redo" });
    });

    it("critic: without a parsed object the prose regex rung still fires", () => {
        expect(parseCriticDecision("This LGTM to me.")).toEqual({
            consensus: true,
            needsMoreContext: false,
            critique: "This LGTM to me.",
        });
    });

    it("architect: a parsed object is honored including explicit escalation fields", () => {
        expect(
            parseFrontierArchitectureDecision("garbage", {
                architectureSpec: "  spec  ",
                confidence: 0.9,
                escalateToStrong: false,
                escalationReason: "",
            }),
        ).toEqual({ architectureSpec: "spec", confidence: 0.9, escalateToStrong: false, escalationReason: "" });
    });

    it("architect: a low-confidence parsed object keeps the threshold defaults", () => {
        const decision = parseFrontierArchitectureDecision("garbage", {
            architectureSpec: "spec",
            confidence: 0.4,
            escalateToStrong: true,
            escalationReason: "risky",
        });
        expect(decision).toEqual({
            architectureSpec: "spec",
            confidence: 0.4,
            escalateToStrong: true,
            escalationReason: "risky",
        });
    });

    it("frontier critic: a parsed object feeds both the base and extended fields", () => {
        expect(
            parseFrontierCriticDecision("garbage", {
                consensus: true,
                needsMoreContext: false,
                requiresStrongCritic: false,
                confidence: 0.9,
                critique: "solid",
                escalationReason: "",
            }),
        ).toEqual({
            consensus: true,
            needsMoreContext: false,
            requiresStrongCritic: false,
            confidence: 0.9,
            critique: "solid",
            escalationReason: "",
        });
    });

    it("worker kind: a parsed object wins over malformed text", () => {
        expect(parseWorkerKind("garbage", WorkerKind.CODE_EXPLORER, { workerKind: "web_researcher" })).toBe(
            WorkerKind.WEB_RESEARCHER,
        );
    });

    it("worker kind: an invalid parsed value falls back to the seed", () => {
        expect(parseWorkerKind("garbage", WorkerKind.INFRA_OPS, { workerKind: "pilot" })).toBe(WorkerKind.INFRA_OPS);
    });

    it("worker kind: without a parsed object the text rung still parses", () => {
        expect(parseWorkerKind('{"workerKind":"infra_ops"}', WorkerKind.CODE_EXPLORER)).toBe(WorkerKind.INFRA_OPS);
    });
});

describe("profile-injected cascade prompts", () => {
    it("the default composition embeds the model-agnostic cascade note", () => {
        expect(reasoningPrompts.complexityRouter).toContain(DEFAULT_CASCADE_NOTE);
        expect(reasoningPrompts.complexityRouter).not.toMatch(/DeepSeek|Claude|GPT-5/u);
    });

    it("a profile note swaps the cascade prose without touching the JSON contract", () => {
        const custom = reasoningPromptsFor("Custom cascade for this profile.");
        expect(custom.complexityRouter).toContain("Custom cascade for this profile.");
        expect(custom.complexityRouter).toContain(
            'Return ONLY this JSON: {"complexity":"trivial|pure_reasoning|tool_complex","routeConfidence":0.0}',
        );
    });

    it("compositions are memoized per note (byte-stable cache anchors)", () => {
        expect(reasoningPromptsFor("note A")).toBe(reasoningPromptsFor("note A"));
        expect(reasoningPromptsFor()).toBe(reasoningPrompts);
    });

    it("every json_object prompt mentions JSON for the provider-side validation", () => {
        const prompts = reasoningPromptsFor("no json word in this note");
        for (const key of [
            "complexityRouter",
            "frontierArchitect",
            "frontierCritic",
            "openaiCritic",
            "leadDelegator",
            "workerCompress",
        ] as const) {
            expect(prompts[key]).toMatch(/json/iu);
        }
    });
});
