import assert from "node:assert/strict";
import { openclawRpc } from "../src/tools/openclaw.ts";

type GatewayBody = { ok: boolean; result?: unknown; error?: { message?: string } };
type Handler = (tool: string, args: Record<string, unknown>) => GatewayBody;

const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
let handler: Handler = () => ({ ok: false, error: { message: "no handler set" } });

const makeResponse = (body: unknown, status = 200): Response =>
    ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "ERR",
        text: async () => JSON.stringify(body),
    }) as unknown as Response;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    const parsed = init?.body ? JSON.parse(String(init.body)) : {};
    const tool = String(parsed.tool ?? "");
    const args = (parsed.args ?? {}) as Record<string, unknown>;
    calls.push({ tool, args });
    return makeResponse(handler(tool, args));
}) as unknown as typeof fetch;

const reset = (next: Handler): void => {
    calls.length = 0;
    handler = next;
};

const toolResult = (details: Record<string, unknown>): Record<string, unknown> => ({
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
});

/* JSON Gateway tools put the machine payload in details, not content. */
const fallbackOk: GatewayBody = {
    ok: true,
    result: toolResult({ provider: "duckduckgo", results: [{ title: "ddg hit" }] }),
};

const run = async (): Promise<void> => {
    reset((tool) =>
        tool === "tavily_search"
            ? { ok: true, result: toolResult({ answer: "AI summary", results: [{ title: "t", url: "u" }] }) }
            : fallbackOk,
    );
    let res = await openclawRpc("web_lookup", { query: "langgraph swarm" }, { maxRetries: 0 });
    assert.equal(res.searchProvider, "tavily", "A: Tavily should answer");
    assert.ok(calls.some((c) => c.tool === "tavily_search"), "A: tavily_search called");
    assert.ok(!calls.some((c) => c.tool === "web_search"), "A: fallback must NOT be called");
    const tavilyArgs = calls.find((c) => c.tool === "tavily_search")!.args;
    assert.equal(tavilyArgs.search_depth, "advanced", "A: rich search_depth sent");
    assert.equal(tavilyArgs.include_answer, true, "A: rich include_answer sent");

    reset((tool) =>
        tool === "tavily_search" ? { ok: false, error: { message: "tavily 500" } } : fallbackOk,
    );
    res = await openclawRpc("web_lookup", { query: "x" }, { maxRetries: 0 });
    assert.equal(res.searchProvider, "duckduckgo", "B: fallback on Tavily error");
    assert.ok(String(res.tavilyFallbackReason).includes("tavily 500"), "B: reason carries Tavily error");

    reset((tool) =>
        tool === "tavily_search" ? { ok: true, result: toolResult({ results: [], answer: "" }) } : fallbackOk,
    );
    res = await openclawRpc("web_lookup", { query: "x" }, { maxRetries: 0 });
    assert.equal(res.searchProvider, "duckduckgo", "C: fallback on empty Tavily");
    assert.equal(res.tavilyFallbackReason, "tavily returned no results", "C: empty-result reason");

    reset(() => ({ ok: false, error: { message: "down" } }));
    await assert.rejects(
        () => openclawRpc("web_lookup", { query: "x" }, { maxRetries: 0 }),
        (err: Error) => /tavily\(/.test(err.message) && /duckduckgo\(/.test(err.message),
        "D: both-fail error mentions Tavily and DuckDuckGo",
    );

    reset(() => fallbackOk);
    await assert.rejects(
        () => openclawRpc("web_lookup", {}, { maxRetries: 0 }),
        /web_lookup requires a query/,
        "E: missing query rejected",
    );
    assert.equal(calls.length, 0, "E: no gateway call for a missing query");
};

run()
    .then(() => {
        globalThis.fetch = originalFetch;
        console.log("websearch-smoke: all scenarios passed");
    })
    .catch((err) => {
        globalThis.fetch = originalFetch;
        console.error(err);
        process.exit(1);
    });
