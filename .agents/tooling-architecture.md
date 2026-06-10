# Tooling Architecture — Pluggable Tool Providers (Design)

> **Status: Partially implemented (2026-06-07).** Design/ADR record. Read with
> [memory.md](memory.md) §4 (OpenClaw and Tooling) and
> [code-guidelines.md](code-guidelines.md) §1/§3/§7. Phases 0-2 landed, plus a
> thin local/web provider split that routes through `ToolRegistry`; the remaining
> transport/workspace/artifact extraction is still open.
>
> This is a rewrite that supersedes the earlier "Opus draft + Codex review" pair.
> Both inputs were evaluated; what was kept, changed, and rejected is recorded in
> [Appendix A](#appendix-a--how-this-reconciles-the-two-prior-proposals). The
> sections below are the single agreed plan.

## 1. Goal

Decouple the reasoning core ("Brain": main graph + swarm) from tool execution so
tool modules become **independently replaceable** and can run **side by side**:

- Replace a backend wholesale (a different web-search service, an MCP server, a
  remote sandbox, a mock) without editing any graph or swarm node.
- Run several providers **at once** (local workspace tools + a dedicated web
  provider + future MCP tools), routed transparently behind one call seam.

The Brain depends only on an **interface (port)**; every backend is an
**adapter**. The pattern is Ports & Adapters (Hexagonal) plus a thin
**registry** that routes one logical tool call to the one provider that owns it.

## 2. Ground truth (verified against the code)

Two facts from the current tree drive every decision below. Both were checked,
not assumed.

### 2.1 There is exactly one Brain tool-execution seam

As of the 2026-06-07 implementation, Brain tool calls funnel through
`ToolRegistry.invoke(alias, args, context) → Promise<ToolResult>`. It is called
in exactly two runtime places:

- [src/swarm/react-worker.ts](../src/swarm/react-worker.ts) — the swarm worker ReAct loop.
- [src/graph/nodes/verify.ts](../src/graph/nodes/verify.ts) — the main-graph `run_tests` (typecheck) call.

`openclawRpc(tool, args, options)` still exists as a compatibility wrapper in
[src/tools/rpc.ts](../src/tools/rpc.ts): Brain aliases route through the default
registry and unwrap raw payloads; unknown raw tool ids still go to the gateway.
Lifecycle (`startOpenClawGateway`/`stopOpenClawGateway` in
[src/main.ts](../src/main.ts)) remains a second, separate seam.

### 2.2 The "OpenClaw tools" are mostly local; only web search uses the gateway

This is the correction that shrinks the whole task. The default registry now
binds these logical aliases to local/web provider descriptors:

| Logical tool                                                     | Real backend today                                                                                                                          | Touches OpenClaw gateway? |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `find_files`, `grep_code`, `ast_read`, `shell_exec`, `run_tests` | `local:*` descriptors wrapping `runLocalPseudoTool` → local `rg`/`npm`/`tsc`/`fs` processes ([local-tools.ts](../src/tools/local-tools.ts)) | **No**                    |
| `web_lookup`                                                     | `web:lookup` descriptor wrapping `tavily_search` then `web_search` via `invokeGatewayTool` ([web-search.ts](../src/tools/web-search.ts))    | **Yes**                   |
| `callLlm` (chat, not a tool)                                     | `jsonPost` → `/v1/chat/completions` ([llm.ts](../src/tools/llm.ts))                                                                         | **Yes** (10 call sites)   |

Consequences:

- The bulk of the tool surface is a **local workspace/exec provider** that has
  nothing to do with OpenClaw. It should not be named or coupled to "OpenClaw".
- The **only** tool that rides the gateway is `web_lookup`. "Replace OpenClaw for
  tools" therefore means "swap one web provider" — small and isolated.
- The gateway is primarily a **shared transport for the model layer**
  (`callLlm`). Whether OpenClaw runs at all is an application/transport concern,
  not a tool detail. A no-op "OpenClaw tool provider lifecycle" is only correct as
  long as `callLlm` keeps the gateway alive; the design must not bake that
  assumption into the tool layer.

So the target is not "one OpenClaw provider behind a port". It is **two real
providers (local + web) behind a registry, over a transport that the model layer
and the web provider share** — which is already the parallel-providers shape the
goal asks for.

## 3. Decision summary

The prior draft left these open; they are now decided. Rationale is in the
referenced sections.

| Question                                 | Decision                                                                                                     | Why                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Provider-id uniqueness                   | **Strict**: duplicate qualified id at registration throws                                                    | Fail at boot, not mid-run (§7). Matches the project's fail-at-build ethos.                             |
| Replacing a logical tool                 | **Alias → qualified-id binding**, not priority shadowing                                                     | Brain keeps asking for `web_lookup`; config rebinds it. No prompt churn (§5, §6).                      |
| Dynamic external tools                   | **Qualified ids** (`provider:tool`); Brain never sees raw strings                                            | Collisions impossible; aliases stay the stable Brain vocabulary (§6).                                  |
| "Parallel" semantics                     | **Routing** (one alias → one provider), not fan-out execution                                                | Retries/errors/idempotency stay well-defined; aggregation is a dedicated provider if ever needed (§5). |
| Worker authorization                     | **Brain-owned `ToolAccessPolicy`**; providers only _suggest_ roles via capability tags                       | A provider must not be able to grant itself a dangerous role (§7).                                     |
| Result/error shape                       | **Structured `ToolResult` + `ToolError`** envelope; built-ins preserve `ToolStatus`/exit-code                | `verify` and `classifyFailure` depend on shape today (§8).                                             |
| Planner tool list                        | **Stable system prompt + appended runtime catalog**, policy-filtered                                         | Protect prompt-cache anchors (§9).                                                                     |
| `transport/` + `llm/` extraction         | Extract **`transport/` now**; `llm/` extraction optional/deferred                                            | The boundary needs a neutral transport; moving the model layer is cosmetic (§4, §10).                  |
| `verify` needing a non-local `run_tests` | **No.** `run_tests` is already local; the `run_tests` alias defaults to the local provider and is rebindable | Keeps the main graph simple; only the swarm needs full pluggability (§5).                              |
| External folder vs external package      | **Import boundary first**, package extraction last                                                           | Prove the seam before packaging work (§10, Phase 5).                                                   |

## 4. Four layers (separation of concerns)

The registry must not carry every concern. Four layers, each with one job:

```
        ┌──────────────────────── BRAIN (main graph + swarm) ───────────────────────┐
        │  verify, runReactWorker  →  depend ONLY on ToolRegistry (by alias)          │
        └───────────────────────────────────────┬───────────────────────────────────┘
                                                 │  (4) Brain policy: ToolAccessPolicy
                                                 │      filters catalog per WorkerKind,
                                                 │      renders the tool list, validates args
        ┌────────────────────────────────────────▼──────────────────────────────────┐
        │  (3) ToolRegistry: resolve alias→qualified id, route to owner, wrap result  │
        │      /error in the neutral envelope, validate catalog at startup            │
        └───────────────┬───────────────────────────────────────┬────────────────────┘
                        ▼                                         ▼
        (2) Local provider                          (2) Web provider
            local:find_files / grep_code /              web:lookup  (alias web_lookup)
            ast_read / shell_exec / run_tests           backends: tavily, duckduckgo
            uses workspace + exec primitives            uses (1) transport
                        │                                         │
                        ▼                                         ▼
        shared safety primitives                    (1) Transport/runtime: OpenClaw
            workspace path guard, artifact store         gateway client (HTTP + lifecycle),
            (used by local providers + patching)         idempotent start/stop; also used
                                                         by the model layer (callLlm)
```

1. **Transport/runtime layer** — starts/stops external processes and transports
   (the OpenClaw gateway today; a future MCP process runtime or remote sandbox
   client). Idempotent, independent of graph state. Shared by the model layer and
   any provider that needs it.
2. **Provider layer** — exposes qualified tool descriptors and the
   **authoritative** execution guards. May depend on a runtime, the workspace
   guard, and env.
3. **Registry layer** — validates catalogs at startup, resolves aliases to
   qualified ids, routes to the owning provider, and enforces the structured
   result/error contract.
4. **Brain-policy layer** — filters the catalog per `WorkerKind`, renders the
   available-tool list for prompts, and runs planner-facing arg validation before
   execution.

Invariant preserved: **the Brain decides what workers may ask for; providers
decide how their own capabilities execute safely.**

## 5. Replacement and parallelism from one mechanism

The registry builds a `Map<QualifiedToolId, ToolProvider>` from every provider's
catalog, plus an `alias → QualifiedToolId` binding table.

- **Replace a logical tool** = rebind its alias. `web_lookup` → `web:lookup`
  today; swap to `web:tavily-direct` or `mcp:search` by changing one binding. No
  Brain/prompt/worker code changes.
- **Replace a whole backend** = register a different provider and rebind its
  aliases. The local provider can be replaced by a remote-sandbox provider the
  same way.
- **Run in parallel** = register several providers; the registry routes per
  resolved id. Local + web already are two providers running side by side.

**Routing, not fan-out.** One alias resolves to one provider per call. If a future
need is "query several search providers and merge", that is modeled as a single
**aggregate provider** (its own descriptor that internally calls others and ranks
results), never as implicit registry fan-out — otherwise retries, idempotency,
error attribution, and ranking become undefined.

**Conflict policy is strict.** Two providers registering the same qualified id is
a startup error. Replacement is always explicit via alias rebinding, never silent
priority shadowing.

## 6. Contracts (the port)

Public contracts live in `src/types/tools/provider.ts`; neutralized arg types in
`src/types/tools/rpc.ts` ([code-guidelines.md](code-guidelines.md) §3). Names are
**provider-neutral** so the port never leaks "OpenClaw".

```ts
/* Stable Brain-facing command names = the existing closed union (minus web backends, see §11.0). */
export type ToolAlias = ToolName;

/* Provider-facing implementation id, always namespaced; collisions are impossible by construction. */
export type QualifiedToolId = `${string}:${string}`;

/* Capability tags a provider declares; the Brain policy reasons over these, not over tool names. */
export type ToolCapability = "read_workspace" | "write_workspace" | "exec_allowlisted" | "external_network";

/* Structured failure kind so routing does not string-match error text (§8). */
export type ToolErrorKind = "validation" | "policy" | "timeout" | "environment" | "provider_unavailable" | "execution";

/* Neutral envelope returned by every invocation; built-ins preserve ToolStatus + exit code. */
export interface ToolResult {
  readonly status: ToolStatus;
  readonly provider: string;
  readonly toolId: QualifiedToolId;
  readonly alias?: ToolAlias;
  readonly exitCode?: number; // preserved for shell_exec / run_tests evidence
  readonly details?: JsonObject;
  readonly content?: string;
  readonly raw?: JsonObject; // untouched provider payload for dynamic tools
}

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly provider?: string;
  readonly toolId?: QualifiedToolId;
}

/* One executable capability, owned by exactly one provider. */
export interface ToolDescriptor {
  readonly id: QualifiedToolId;
  readonly aliases?: readonly ToolAlias[]; // logical names the Brain may bind to this id
  readonly capabilities: readonly ToolCapability[];
  readonly suggestedKinds?: readonly WorkerKind[]; // hint only; the Brain policy decides (§7)
  readonly describe: string; // short, schema-like line for the catalog render
  validate(args: ToolArgs): SanitizedAction; // Brain-side planner feedback (advisory)
  invoke(args: ToolArgs, context: ToolCallContext): Promise<ToolResult>; // authoritative guard + execution
}

/* One backend module (local, web, mcp, mock, ...). Owns its own runtime lifecycle. */
export interface ToolProvider {
  readonly name: string; // stable id for telemetry and conflict messages
  readonly catalog: readonly ToolDescriptor[];
  start?(): Promise<void>; // idempotent; no-op when nothing external to start
  stop?(): Promise<void>;
}

/* Brain-owned authorization and prompt rendering. */
export interface ToolAccessPolicy {
  allowedAliases(kind: WorkerKind, catalog: readonly ToolDescriptor[]): readonly ToolAlias[];
  validate(kind: WorkerKind, alias: ToolAlias, args: ToolArgs): SanitizedAction;
  renderCatalog(kind: WorkerKind): string; // runtime context, not a system-prompt anchor (§9)
}

/* The composite the Brain talks to. Aliases in, structured results out. */
export interface ToolRegistry {
  invoke(alias: ToolAlias, args: ToolArgs, context: ToolCallContext): Promise<ToolResult>;
  allowedAliases(kind: WorkerKind): readonly ToolAlias[]; // replaces the static WORKER_TOOLS lookup
  renderCatalog(kind: WorkerKind): string; // replaces the static prompt tool list
  start(): Promise<void>; // fan-out to every provider, in order
  stop(): Promise<void>; // reverse order
}
```

`ToolName` stays a closed `as const` union in [src/consts/tools.ts](../src/consts/tools.ts):
it is the **alias** vocabulary the Brain references with compile-time safety (e.g.
`verify` → `ToolName.RUN_TESTS`). Dynamic external tools never widen `ToolName`;
they are addressed only by `QualifiedToolId`. This keeps the closed-union safety
for the core path while allowing open extension at the edges.

## 7. Safety envelope (defense-in-depth, mapped to layers)

The existing four independent guards ([code-guidelines.md](code-guidelines.md) §7)
survive the split and are strengthened by landing on opposite sides of the port.

| Guard                                                                   | Owner after split        | Where it lives                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which role may request which tool                                       | **Brain**                | `ToolAccessPolicy.allowedAliases(kind, catalog)` — replaces the static `WORKER_TOOLS` map. Providers only _suggest_ via `suggestedKinds`/`capabilities`; the policy is authoritative so a provider cannot self-grant a role. |
| Arg shaping + planner feedback                                          | Per-tool (advisory)      | `ToolDescriptor.validate()` — the per-tool cases extracted from the `sanitizeToolArgs` switch in [tool-validation.ts](../src/swarm/tool-validation.ts).                                                                      |
| Workspace path bound                                                    | Provider (authoritative) | inside each local descriptor's `invoke()`, via the shared `resolveWorkspacePath`. Runs **always**, regardless of caller checks.                                                                                              |
| Shell allowlist re-check                                                | Provider (authoritative) | inside the exec descriptor's `invoke()`, via `SAFE_DIRECT_EXEC_COMMANDS`/`SAFE_COMMAND_SPECS`.                                                                                                                               |
| Shared contract (`ToolName`, `ToolStatus`, `SAFE_DIRECT_EXEC_COMMANDS`) | Shared                   | stays defined once in [src/consts/tools.ts](../src/consts/tools.ts).                                                                                                                                                         |

**Trusted-code boundary (explicit).** A `ToolProvider` is executable code; a TS
interface does not sandbox it. In-repo providers are trusted. Any future
untrusted provider must be reached through a constrained protocol (MCP or a
sandboxed subprocess), **not** imported as a local module with full process
access. This is a stated boundary, not built now.

## 8. Result and error compatibility

Today `verify` reads `extractToolStatus(report)` for `{ status, exitCode }`
([graph/parsers.ts](../src/graph/parsers.ts), [verify.ts](../src/graph/nodes/verify.ts)),
and the worker treats non-zero shell exit as _evidence, not failure_
([react-worker.ts](../src/swarm/react-worker.ts)). `classifyFailure()`
string-matches messages for "gateway/timeout/permission/…".

- Every `invoke` returns a `ToolResult`. Built-in aliases (`run_tests`,
  `shell_exec`, …) **must** populate `status` and `exitCode` so existing
  verification and evidence semantics are byte-for-byte preserved. Dynamic tools
  may put arbitrary payload in `raw` without breaking the Brain.
- Providers throw `ToolError` with a structured `kind`. Swarm routing classifies
  HITL-vs-reasoning from `kind` (e.g. `environment`/`provider_unavailable`/`timeout`
  → HITL; `validation`/`execution` → back to the worker). Message text becomes
  operator context only, replacing the brittle substring matching in
  `classifyFailure()`.

## 9. Prompt-cache safety

`WORKER_PROMPTS` system strings are cache anchors
([code-guidelines.md](code-guidelines.md) §6). Catalogs must not be interpolated
into them. Keep the system prompt stable and append a deterministic
`renderCatalog(kind)` block to the **worker user context** (where the subtask and
prior observations already live in [react-worker.ts](../src/swarm/react-worker.ts)).
Descriptions stay short, schema-like, and policy-filtered so the planner is not
flooded.

## 10. Dependency injection (reuse the proven HITL pattern)

The project already injects a non-serializable dependency (the HITL resolver) via
`configurable` + `readHitlResolver(config)`, keeping it out of checkpointed graph
state ([main.ts](../src/main.ts), [resolvers.ts](../src/hitl/resolvers.ts),
[swarm-node.ts](../src/graph/nodes/swarm-node.ts)). Reuse it verbatim:

- [main.ts](../src/main.ts) builds the registry once and passes it in
  `configurable[TOOL_REGISTRY_CONFIG_KEY]` alongside the HITL resolver.
- Main-graph nodes that call tools (`verify`) read it via `readToolRegistry(config)`;
  `buildMainGraph()` stays parameterless.
- The swarm is already rebuilt per invocation in `swarmNode`
  ([swarm-node.ts:12](../src/graph/nodes/swarm-node.ts#L12)), so pass the registry
  by **closure**: `buildSwarm({ tools })` → workers close over it →
  `runReactWorker(state, kind, tools)`. No need to thread `config` through the
  ReAct internals.

Keeps the documented invariant: **the tool layer is never serialized into graph
state.**

## 11. Target folder layout

Decomposed by **real coupling** (§2), not by vendor. Barrels, concrete `.ts`
imports inside a subsystem, and "constants once in `src/consts/*`" rules from
[code-guidelines.md](code-guidelines.md) §1/§3 all still apply.

```
src/
  transport/                 neutral OpenClaw gateway client (lifecycle + HTTP)   [extract in Phase 3]
    gateway.ts  http.ts  errors.ts  index.ts
  workspace/                 resolveWorkspacePath — shared safety primitive       [removes patching→tools edge]
    index.ts
  artifacts/                 storeArtifact — runtime infra used after any result
    index.ts
  tools/
    registry.ts              ToolRegistry: build map, bind aliases, route, lifecycle fan-out
    policy.ts                ToolAccessPolicy: Brain-owned role→alias gate + catalog render
    config.ts                TOOL_REGISTRY_CONFIG_KEY, readToolRegistry(config)
    bindings.ts              default alias → QualifiedToolId table
    index.ts                 barrel + createDefaultToolRegistry()
    providers/
      local/                 first provider: workspace + exec (NO gateway)
        index.ts             createLocalProvider(): ToolProvider
        descriptors/         one file per tool: id, capabilities, validate, invoke
          find-files.ts  grep-code.ts  ast-read.ts  shell-exec.ts  run-tests.ts
      web/                   second provider: web_lookup over transport (tavily → duckduckgo)
        index.ts             createWebProvider(): ToolProvider
        descriptors/lookup.ts
      mcp/                   future provider (catalog from an MCP server)         [Phase 4+]
  llm/                       OPTIONAL Phase 3 cleanup: move callLlm/models/pricing out of tools/
  types/tools/
    provider.ts              ToolDescriptor, ToolProvider, ToolRegistry, ToolAccessPolicy, ToolResult, ToolError, QualifiedToolId
    rpc.ts                   ToolArgs, ToolCallOptions, ToolCallContext, JsonObject (neutralized names)
```

`src/` root stays reserved for `main.ts` and `index.ts`
([code-guidelines.md](code-guidelines.md) §3). `transport/`, `workspace/`,
`artifacts/`, and the provider folders are real subsystems with stable boundaries,
so each gets its own folder and barrel.

## 12. Phased migration (incremental, each independently shippable)

Ordered for the smallest blast radius first. Recommended scope for this solo repo:
**do Phase 0–1 next; Phase 2–3 reach the requested target; Phase 4–5 are
deferred.** Each phase ends green on `npm test` (typecheck + lint + the four smoke
suites).

### Phase 0 — Neutralize names, no behavior change

- Rename public tool types `OpenClawRpcArgs`/`OpenClawRpcOptions` →
  `ToolArgs`/`ToolCallOptions` (≈10 files; mechanical).
- Split the `ToolName` union: keep Brain aliases (`find_files`, `grep_code`,
  `ast_read`, `shell_exec`, `web_lookup`, `run_tests`); move web backend names
  (`tavily_search`, `web_search`) into a provider-internal const in
  [consts/web.ts](../src/consts/web.ts). Lowest risk; establishes the vocabulary.

### Phase 1 — Registry facade + DI, no file moves

- Add `ToolRegistry` as a thin facade over today's `openclawRpc`, plus
  `createDefaultToolRegistry()`.
- Inject into `verify` via `configurable[TOOL_REGISTRY_CONFIG_KEY]` and into the
  swarm via `buildSwarm({ tools })` → `runReactWorker(state, kind, tools)`.
- **Milestone: "replace behind an interface".** A fake/mock registry can drive
  `verify` and the ReAct loop in tests without starting any OpenClaw path.

### Phase 2 — Structured contracts + Brain-owned policy

- Introduce `ToolResult`/`ToolError`; built-ins preserve `status`/`exitCode`;
  `verify`/`classifyFailure` read structured fields.
- Convert the `sanitizeToolArgs` switch into per-descriptor `validate()`.
- `ToolAccessPolicy` replaces the static `WORKER_TOOLS` gate; system prompts stay
  stable, catalog appended to user context.

### Phase 3 — Real provider split + alias binding + parallel (the requested target)

- Split into `providers/local/` (workspace+exec, no gateway) and `providers/web/`
  (gateway-backed lookup). Extract `transport/`, `workspace/`, `artifacts/` to
  their shared owners (this also removes the `patching → tools` edge).
- Registry resolves aliases to qualified ids via `bindings.ts`.
- Prove **replacement** with a fake provider and **parallel routing** with a
  second real web provider (e.g. direct Tavily, no gateway). Optionally move
  `callLlm`/models/pricing into `src/llm/`.

### Phase 4 — Fully dynamic catalog (only if a real need appears)

- Namespaced dynamic tools the planner discovers at runtime; registry-derived
  `allowedAliases`/`renderCatalog`; first MCP adapter.

### Phase 5 — Package-level extraction (optional)

- Once the contract is stable, move a provider to `packages/<provider>/` (or an
  external module) imported through the same factory. "Replace OpenClaw with a
  different module" becomes a packaging concern, not a graph refactor.

## 13. Acceptance checks (extend the smoke harness)

This refactor touches safety and execution, so each phase adds targeted coverage
alongside the existing `smoke:react|patch|hitl|websearch`:

- default registry exposes exactly the current built-in aliases;
- duplicate qualified ids fail at startup (strict);
- rebinding `web_lookup` replaces the backend without changing worker code;
- the Brain policy rejects an unapproved tool even if a provider advertises it;
- `run_tests` preserves verification status/exit-code behavior;
- a fake provider drives `verify` and the ReAct loop without starting OpenClaw;
- shell allowlist and workspace-escape guards still reject unsafe input.

## 14. Explicit tradeoff

Phases 2–4 move part of the tool surface from compile-time closed unions toward a
runtime registry of descriptors — a deliberate exchange of some static guarantees
for plugin extensibility. Mitigations: (a) the Brain's hardcoded references
(`verify` → `RUN_TESTS`) keep `ToolName` typing; (b) the registry validates the
merged catalog at startup (strict ids) so duplicate/missing-owner errors surface
at boot; (c) `QualifiedToolId` is a template-literal type and aliases stay a
closed union, so raw-string drift is caught by the compiler.

## 15. Codex implementation delta for Opus review (2026-06-07)

Implemented:

- `ToolName` is now the Brain-facing alias vocabulary only. Gateway backend ids
  moved to `WebGatewayToolName`, so `tavily_search`/`web_search` no longer appear
  as first-class Brain tools.
- Neutral tool contracts landed under `src/types/tools/`: `ToolArgs`,
  `ToolCallOptions`, `ToolResult`, `ToolError`, `ToolDescriptor`,
  `ToolProvider`, `ToolAccessPolicy`, and `ToolRegistry`. The old
  `OpenClawRpcArgs`/`OpenClawRpcOptions` names remain as compatibility aliases.
- `createDefaultToolRegistry()` registers local and web providers, validates
  duplicate qualified ids at startup, resolves aliases through
  `DEFAULT_TOOL_BINDINGS`, and exposes `invoke`, `validate`, `allowedAliases`,
  `renderCatalog`, `start`, and `stop`.
- Main graph `verify` reads the registry from `configurable` via
  `readToolRegistry(config)` and consumes structured `ToolResult.status` /
  `ToolResult.exitCode` directly.
- `swarmNode` reads the same injected registry and passes it by closure into
  `buildSwarm({ tools })`; `runReactWorker` validates and invokes through the
  registry, while appending the policy-rendered catalog to worker user context.
- `sanitizeToolArgs()` remains as a public compatibility helper, but delegates to
  the default registry instead of owning the validation switch.
- `openclawRpc()` remains as a compatibility wrapper: Brain aliases route through
  the default registry and unwrap raw payloads; unknown raw tool ids still go to
  `invokeGatewayTool`.
- Smoke coverage now checks default registry policy rendering, strict
  duplicate qualified-id failure, and structured provider error kinds alongside
  the existing ReAct, patch, HITL, and web-search paths.

Plan improvements made during implementation:

- Provider descriptors wrap the existing local/web executors first instead of
  moving `workspace`, `artifacts`, and `transport` in the same patch. This keeps
  the behavior-preserving registry seam reviewable before the physical package
  layout changes.
- Validation lives on descriptors, but the registry performs the Brain-owned
  authorization check before calling descriptor validation. That makes policy
  enforcement depend on alias binding plus `WORKER_TOOLS`, not provider
  `suggestedKinds`.
- The runtime catalog is appended to worker user context while leaving
  `WORKER_PROMPTS` byte-stable.
- Local/web providers now throw structured `ToolError`s at the provider
  boundary. `classifyProviderError()` no longer string-matches provider messages;
  it preserves existing `ToolError.kind` values and treats unexpected non-tool
  errors as `EXECUTION`.

Still open:

- Extract `transport/`, `workspace/`, and `artifacts/` into their proposed
  subsystem roots; `patching` still imports `resolveWorkspacePath` from
  `src/tools`.
- Split local provider descriptors into one file per tool if Opus wants the
  target folder layout exactly.
- Add a fake-provider test that drives `verify` and a ReAct loop without touching
  OpenClaw; current smoke coverage validates registry policy and duplicate-id
  safety but does not yet exercise a full fake invocation path.
- Add an alternate real web provider or mock binding test to prove alias rebinding
  beyond the current compatibility wrapper.

---

## Appendix A — How this reconciles the two prior proposals

The earlier file held an Opus draft (a port + registry/composite, DI via the HITL
pattern, three scope tiers) and a Codex critical review (12 weak spots + a 4-layer
redesign). This plan is the synthesis.

**Kept from the Opus draft:** the single-seam observation (verified accurate); Ports
& Adapters + registry; reuse of the HITL `configurable`/closure DI; the
closed-union `ToolName` for the core path; incremental, shippable tiers; the
transport-vs-tools separation.

**Adopted from the Codex review:** the 4-layer model (transport / provider /
registry / Brain policy); **alias → qualified-id binding** as the replacement
mechanism (the single most valuable idea — it replaces tools without prompt
churn); Brain-owned `ToolAccessPolicy` over provider-declared `workerKinds`;
structured `ToolResult`/`ToolError` before a second provider; "parallel = routing,
not fan-out"; moving `workspace`/`artifacts` out from under the provider;
import-boundary-before-package; the lower-risk migration order (neutralize →
facade → contracts → split) over the original tier order.

**Rejected or deferred:** a full `createAppRuntime({ llm, tools })` runtime object
(Codex #1) — reduced to "extract a neutral `transport/` with idempotent start/stop";
sandboxing untrusted providers (Codex #12) — kept as a stated boundary, not built;
the dynamic catalog and MCP adapter (Opus Tier 3 / Codex layer-1 future) — pushed
to Phase 4 behind a real need; priority-based conflict shadowing — dropped in
favor of strict ids + explicit alias rebinding.

**Added here (in neither input):** the verified finding that the "OpenClaw tools"
are mostly **local** processes and only `web_lookup` rides the gateway (§2.2). That
reframes the target from "wrap one OpenClaw provider" to "two natural providers
(local + web) over a shared transport", which is already the parallel shape the
goal wants and makes "replace OpenClaw" a one-binding swap.
