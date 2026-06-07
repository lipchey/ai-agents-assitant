# Task — Structured `ToolError` from local + web providers

> Implementation spec for the deferred half of review finding #2 on the tool
> provider registry. Read with [tooling-architecture.md](tooling-architecture.md)
> §7 (safety envelope), §8 (result/error compatibility), §15 (Codex delta), and
> [code-guidelines.md](code-guidelines.md) §1/§7. Self-contained — drivable by an
> implementation agent.

## Goal

Finish the "Still open" item from [tooling-architecture.md](tooling-architecture.md)
§15: providers (local, web) must throw a **structured `ToolError` with `kind`**
instead of `OpenClawError`. After this, the registry's substring matching becomes
a pure fallback, and the HITL-vs-reasoning routing relies on `ToolError.kind` as
§8 intends — not on brittle message-text matching.

Background: the registry seam, `ToolError`/`ToolErrorKind`, and structured
routing already landed (commits `0d03141`, `32f8d46`). The web provider's
total-failure path already throws `ToolError(PROVIDER_UNAVAILABLE)`. What remains
is converting the per-call validation/exec throws in the local and web executors.

## Key invariant (do not break)

Every local-executor exception today maps `classifyFailure → REASONING`
([../src/swarm/tool-validation.ts](../src/swarm/tool-validation.ts)). The new
kinds (`VALIDATION` / `POLICY` / `EXECUTION`) also all map to `REASONING`. So the
local path must show **no routing change** — only honest `kind` values replacing
text. Why this is safe to assume:

- **Process failures resolve, they do not throw.** `runLocalProcess` resolves
  with `{ status: FAILED | TIMED_OUT, details }` on `error`/`exit`/timeout
  ([../src/tools/local-tools.ts](../src/tools/local-tools.ts)). So local executor
  *exceptions* are exclusively validation/config errors (missing args,
  non-allowlisted command, workspace escape) — never "environment".
- **No code matches `instanceof OpenClawError`** (verified: zero hits). Changing
  the thrown type breaks no type-based catch.

The only intentional routing change (web total-failure → HITL) already shipped.

## Out of scope

- **Transport/model layer** — `http.ts`, `gateway.ts`, `llm.ts`. Their
  `OpenClawError`s are either absorbed by the web fallback or belong to `callLlm`
  (the model layer, not a tool). Leave as-is.
- **`workspace.ts`** — `resolveWorkspacePath` is shared by `local-tools.ts` **and**
  `patching/patch-blocks.ts`. Keep it decoupled from the tool-error taxonomy (it
  keeps throwing `OpenClawError`); convert it at the provider boundary instead
  (Step 3).

## Kind mapping

| Throw site | Current | New `kind` | Rationale |
| --- | --- | --- | --- |
| [local-tools.ts:24](../src/tools/local-tools.ts#L24) `assertSafeDirectExecCommand` (non-allowlisted) | `OpenClawError` | `POLICY` | authoritative shell-allowlist re-check (§7) |
| [local-tools.ts:92](../src/tools/local-tools.ts#L92) no local command spec | `OpenClawError` | `EXECUTION` | internal misconfig |
| [local-tools.ts:119](../src/tools/local-tools.ts#L119) grep requires pattern | `OpenClawError` | `VALIDATION` | missing arg |
| [local-tools.ts:145](../src/tools/local-tools.ts#L145) ast_read requires path | `OpenClawError` | `VALIDATION` | missing arg |
| [local-tools.ts:167](../src/tools/local-tools.ts#L167) `{tool}` requires a command | `OpenClawError` | `VALIDATION` | missing arg |
| [web-search.ts:54](../src/tools/web-search.ts#L54) requires a query | `OpenClawError` | `VALIDATION` | missing arg |
| [workspace.ts:10](../src/tools/workspace.ts#L10) path escapes | `OpenClawError` (**keep**) | wrapped → `EXECUTION` at boundary | shared primitive stays taxonomy-free |

All of these route to `REASONING` — `POLICY`/`VALIDATION`/`EXECUTION` are
equivalent for routing, so the choice is for telemetry/operator clarity only.

## Step 1 — `local-tools.ts`: structured throws at the source

- Add imports: `import { ToolError } from "./errors.ts";` and `ToolErrorKind`
  from `"../consts"`.
- Replace the 5 `throw new OpenClawError(...)` sites with
  `throw new ToolError(ToolErrorKind.<KIND>, <message>)` per the table. Do **not**
  set `provider`/`toolId` here — this layer is provider-agnostic; the boundary
  adds attribution.
- Remove the now-unused `OpenClawError` import (eslint will flag it). Keep
  `resolveWorkspacePath`.

## Step 2 — `web-search.ts`: query guard

- [web-search.ts:54](../src/tools/web-search.ts#L54):
  `throw new ToolError(ToolErrorKind.VALIDATION, "web_lookup requires a query.")`.
  `ToolError`/`ToolErrorKind` are already imported. Remove `OpenClawError` if it
  becomes unused.

## Step 3 — `invokeLocal`: provider boundary guarantees the envelope

In [../src/tools/providers/local/descriptors.ts](../src/tools/providers/local/descriptors.ts)
wrap `invokeLocal` so **everything leaving the provider is a `ToolError` with
attribution** — this catches the `workspace.ts` escape and any unexpected error
without any substring matching:

```ts
const invokeLocal = async (id, alias, args, context): Promise<ToolResult> => {
    try {
        const payload = await runLocalPseudoTool(alias, args, context);
        if (!payload) {
            throw new ToolError(ToolErrorKind.EXECUTION, `Local provider does not own ${alias}.`, {
                provider: ToolProviderName.LOCAL, toolId: id,
            });
        }
        return createToolResult(ToolProviderName.LOCAL, id, payload, alias);
    } catch (error) {
        if (error instanceof ToolError) {
            throw error; // kind already precise (Step 1)
        }
        // workspace escape and other leaks → structured envelope with attribution
        throw new ToolError(ToolErrorKind.EXECUTION, errorMessage(error), {
            cause: error, provider: ToolProviderName.LOCAL, toolId: id,
        });
    }
};
```

(`errorMessage` from `"../../../shared"`.)

## Step 4 — simplify `classifyProviderError` in the registry

After Steps 1–3, local/web always throw `ToolError`, so the substring block in
`classifyProviderError` ([../src/tools/registry.ts](../src/tools/registry.ts)) is
dead. Drop the substring heuristic; keep a conservative fallback:

```ts
const classifyProviderError = (error: unknown): ToolErrorKind =>
    error instanceof ToolError ? error.kind : ToolErrorKind.EXECUTION;
```

Keep the `invoke` catch (passthrough for `ToolError`, wrap for the unexpected).
Do **not** touch `classifyFailure` in
[../src/swarm/tool-validation.ts](../src/swarm/tool-validation.ts) — its
non-`ToolError` fallback is still needed for failures raised outside `invoke`
(e.g. `storeArtifact` / serialization inside the worker).

## Step 5 — tests (hermetic; no network or subprocess)

Add cases to [../scripts/react-smoke.ts](../scripts/react-smoke.ts) (the registry,
`ToolError`, and `ToolErrorKind` are already imported there). Each call throws
**before** any spawn, so no subprocess runs:

```ts
const reg = createDefaultToolRegistry();
const rejects = async (alias, args, kind) => {
    await assert.rejects(
        () => reg.invoke(alias, args),
        (e) => e instanceof ToolError && e.kind === kind,
    );
};
await rejects(ToolName.GREP_CODE, {}, ToolErrorKind.VALIDATION);                    // missing pattern
await rejects(ToolName.AST_READ, {}, ToolErrorKind.VALIDATION);                     // missing path
await rejects(ToolName.SHELL_EXEC, { command: "rm -rf /" }, ToolErrorKind.POLICY);  // allowlist
await rejects(ToolName.FIND_FILES, { path: "../../etc" }, ToolErrorKind.EXECUTION); // escape → boundary
// kind → FailureType
assert.equal(classifyFailure(new ToolError(ToolErrorKind.VALIDATION, "x")), FailureType.REASONING);
assert.equal(classifyFailure(new ToolError(ToolErrorKind.PROVIDER_UNAVAILABLE, "x")), FailureType.ENVIRONMENT);
```

(`assert.rejects` makes `run()` async — add `await`; export `classifyFailure`
from the `src` barrel if it is not already visible to the smoke entry.)

## Step 6 — docs

In [tooling-architecture.md](tooling-architecture.md) §15 "Still open", mark that
local/web providers now throw structured `ToolError` and that
`classifyProviderError` is reduced to a fallback.

## Invariants / do not touch

- `WORKER_PROMPTS` and `renderCatalog` stay byte-stable (zero prompt changes).
- `verify` reads `ToolResult.status` / `.exitCode` — independent of exception type.
- Local-command exit-code / `status` semantics (FAILED/TIMED_OUT as a **result**,
  not a throw) are unchanged.
- `openclawRpc` will now propagate `ToolError` instead of `OpenClawError` for bad
  brain-alias args — acceptable (zero `instanceof OpenClawError` in the repo).

## Definition of done

- `npm test` green (typecheck + lint + the 4 smoke suites); new smoke cases pass.
- No `throw new OpenClawError` remains in `local-tools.ts` / `web-search.ts`.
- `registry.ts` has no substring-based error classification.
- Risk is low: all local kinds → `REASONING` (routing unchanged); only
  `error.kind` / the thrown type changes.
