import { describe, it, expect } from "vitest";
import { asRecord, extractJsonObject } from "../../src/shared/json.ts";
import { parseRouterDecision, parseCriticDecision } from "../../src/graph/parsers.ts";
import { parseReactDecision } from "../../src/swarm/tool-validation.ts";
import { GraphComplexity } from "../../src/consts/graph.ts";
import { ReactDecisionKind } from "../../src/consts/worker.ts";

/*
 * Characterization tests for the defensive parser fallback ladders. They pin the
 * CURRENT output of every rung so a later refactor must preserve it verbatim:
 *   happy parse -> balanced-object scan -> fenced strip -> prose extraction ->
 *   heuristic / regex / prose->FINAL default.
 */

describe("extractJsonObject ladder (src/shared/json.ts)", () => {
    it("parses a valid nested object via the balanced scan", () => {
        expect(extractJsonObject('{"x":1,"y":{"z":2}}')).toEqual({ x: 1, y: { z: 2 } });
    });

    it("returns null for an unbalanced object that never closes", () => {
        expect(extractJsonObject('{"x": 1')).toBeNull();
    });

    it("returns null for a balanced but invalid object", () => {
        expect(extractJsonObject('{"x": nope}')).toBeNull();
    });

    it("strips a json-tagged code fence", () => {
        expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it("strips a bare code fence with no language tag", () => {
        expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it("prefers the fenced rung over earlier prose json", () => {
        expect(extractJsonObject('intro {"a":1}\n```json\n{"b":2}\n```')).toEqual({ b: 2 });
    });

    it("falls back to the whole-text scan when the fence holds no json", () => {
        expect(extractJsonObject('```\nno json here\n```\n{"c":3}')).toEqual({ c: 3 });
    });

    it("skips a failed balanced object and scans to the next candidate", () => {
        expect(extractJsonObject('{ not: json } then {"d":4}')).toEqual({ d: 4 });
    });

    it("extracts prose-wrapped json", () => {
        expect(extractJsonObject('Here is the answer: {"answer":42} thanks')).toEqual({ answer: 42 });
    });

    it("returns the first inner object when handed a json array", () => {
        expect(extractJsonObject('[{"a":1},{"b":2}]')).toEqual({ a: 1 });
    });
});

describe("asRecord guard (src/shared/json.ts)", () => {
    it("passes a plain object through", () => {
        expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    });

    it("rejects an array", () => {
        expect(asRecord([1, 2])).toBeNull();
    });

    it("rejects null", () => {
        expect(asRecord(null)).toBeNull();
    });

    it("rejects a string", () => {
        expect(asRecord("not an object")).toBeNull();
    });

    it("rejects a number", () => {
        expect(asRecord(42)).toBeNull();
    });
});

describe("parseRouterDecision ladder (src/graph/parsers.ts)", () => {
    it("honors a valid structured decision", () => {
        expect(parseRouterDecision('{"complexity":"pure_reasoning","routeConfidence":0.9}', "irrelevant")).toEqual({
            complexity: GraphComplexity.PURE_REASONING,
            routeConfidence: 0.9,
        });
    });

    it("clamps an out-of-range confidence to one", () => {
        expect(parseRouterDecision('{"complexity":"tool_complex","routeConfidence":1.5}', "irrelevant")).toEqual({
            complexity: GraphComplexity.TOOL_COMPLEX,
            routeConfidence: 1,
        });
    });

    it("honors a code-fenced decision", () => {
        expect(
            parseRouterDecision('```json\n{"complexity":"trivial","routeConfidence":0.5}\n```', "irrelevant"),
        ).toEqual({ complexity: GraphComplexity.TRIVIAL, routeConfidence: 0.5 });
    });

    it("honors a prose-wrapped decision", () => {
        expect(
            parseRouterDecision('I think: {"complexity":"tool_complex","routeConfidence":0.8} done', "irrelevant"),
        ).toEqual({ complexity: GraphComplexity.TOOL_COMPLEX, routeConfidence: 0.8 });
    });

    it("falls back to the tool heuristic on malformed json", () => {
        expect(parseRouterDecision("garbage {", "fix the bug in this code")).toEqual({
            complexity: GraphComplexity.TOOL_COMPLEX,
            routeConfidence: 0.75,
        });
    });

    it("falls back to the heuristic when confidence is missing", () => {
        expect(parseRouterDecision('{"complexity":"trivial"}', "fix the bug")).toEqual({
            complexity: GraphComplexity.TOOL_COMPLEX,
            routeConfidence: 0.75,
        });
    });

    it("falls back to the heuristic when complexity is not a known value", () => {
        expect(parseRouterDecision('{"complexity":"wizardry","routeConfidence":0.9}', "hello there")).toEqual({
            complexity: GraphComplexity.TRIVIAL,
            routeConfidence: 0.6,
        });
    });

    it("falls back to the reasoning heuristic when confidence is a string", () => {
        expect(parseRouterDecision('{"complexity":"trivial","routeConfidence":"0.9"}', "explain the design")).toEqual({
            complexity: GraphComplexity.PURE_REASONING,
            routeConfidence: 0.65,
        });
    });

    it("lands on the trivial heuristic default when no signal matches", () => {
        expect(parseRouterDecision("no structured output", "hello there")).toEqual({
            complexity: GraphComplexity.TRIVIAL,
            routeConfidence: 0.6,
        });
    });
});

describe("parseCriticDecision ladder (src/graph/parsers.ts)", () => {
    it("honors a valid structured decision", () => {
        expect(parseCriticDecision('{"consensus":true,"needsMoreContext":false,"critique":"all good"}')).toEqual({
            consensus: true,
            needsMoreContext: false,
            critique: "all good",
        });
    });

    it("honors a code-fenced decision", () => {
        expect(
            parseCriticDecision('```json\n{"consensus":false,"needsMoreContext":true,"critique":"redo"}\n```'),
        ).toEqual({ consensus: false, needsMoreContext: true, critique: "redo" });
    });

    it("honors a prose-wrapped decision", () => {
        expect(
            parseCriticDecision('Verdict: {"consensus":true,"needsMoreContext":false,"critique":"ok"} thanks'),
        ).toEqual({ consensus: true, needsMoreContext: false, critique: "ok" });
    });

    it("derives consensus from the regex fallback on approval prose", () => {
        expect(parseCriticDecision("This LGTM to me.")).toEqual({
            consensus: true,
            needsMoreContext: false,
            critique: "This LGTM to me.",
        });
    });

    it("derives needsMoreContext from the regex fallback", () => {
        expect(parseCriticDecision("We need more context to decide.")).toEqual({
            consensus: false,
            needsMoreContext: true,
            critique: "We need more context to decide.",
        });
    });

    it("lands on the negative regex default with the raw content as critique", () => {
        expect(parseCriticDecision("This is simply wrong.")).toEqual({
            consensus: false,
            needsMoreContext: false,
            critique: "This is simply wrong.",
        });
    });

    it("mixes a json critique with regex booleans on a partial object", () => {
        expect(parseCriticDecision('{"critique":"some critique"}')).toEqual({
            consensus: false,
            needsMoreContext: false,
            critique: "some critique",
        });
    });

    it("lets a json boolean override matching prose regex", () => {
        expect(parseCriticDecision('{"consensus":false} but LGTM')).toEqual({
            consensus: false,
            needsMoreContext: false,
            critique: '{"consensus":false} but LGTM',
        });
    });
});

describe("parseReactDecision ladder (src/swarm/tool-validation.ts)", () => {
    it("parses a valid ACT decision", () => {
        expect(
            parseReactDecision('{"thought":"need to search","action":{"tool":"grep_code","args":{"pattern":"foo"}}}'),
        ).toEqual({
            kind: ReactDecisionKind.ACT,
            thought: "need to search",
            tool: "grep_code",
            args: { pattern: "foo" },
        });
    });

    it("parses a valid FINAL decision", () => {
        expect(parseReactDecision('{"thought":"done","final":"the answer is 42"}')).toEqual({
            kind: ReactDecisionKind.FINAL,
            thought: "done",
            final: "the answer is 42",
        });
    });

    it("defaults ACT args to an empty object when absent", () => {
        expect(parseReactDecision('{"action":{"tool":"find_files"}}')).toEqual({
            kind: ReactDecisionKind.ACT,
            thought: "",
            tool: "find_files",
            args: {},
        });
    });

    it("parses a code-fenced ACT decision", () => {
        expect(
            parseReactDecision('```json\n{"thought":"t","action":{"tool":"shell_exec","args":{"command":"ls"}}}\n```'),
        ).toEqual({
            kind: ReactDecisionKind.ACT,
            thought: "t",
            tool: "shell_exec",
            args: { command: "ls" },
        });
    });

    it("trims the thought field", () => {
        expect(parseReactDecision('{"thought":"  spaced thought  ","final":"answer"}')).toEqual({
            kind: ReactDecisionKind.FINAL,
            thought: "spaced thought",
            final: "answer",
        });
    });

    it("lets prose-wrapped json beat the prose->FINAL default", () => {
        expect(parseReactDecision('Reasoning... {"thought":"x","final":"answer"} trailing')).toEqual({
            kind: ReactDecisionKind.FINAL,
            thought: "x",
            final: "answer",
        });
    });

    it("converges prose with no json to a FINAL decision", () => {
        expect(parseReactDecision("I'm not sure but I think the answer is probably 42.")).toEqual({
            kind: ReactDecisionKind.FINAL,
            thought: "",
            final: "I'm not sure but I think the answer is probably 42.",
        });
    });

    it("converges malformed json to FINAL with the raw trimmed content", () => {
        expect(parseReactDecision('{"thought": broken')).toEqual({
            kind: ReactDecisionKind.FINAL,
            thought: "",
            final: '{"thought": broken',
        });
    });

    it("diverts an empty tool from ACT to the FINAL branch", () => {
        expect(parseReactDecision('{"action":{"tool":"  "},"final":"fin"}')).toEqual({
            kind: ReactDecisionKind.FINAL,
            thought: "",
            final: "fin",
        });
    });
});
