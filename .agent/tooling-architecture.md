# Tooling Architecture — Pluggable Tool Providers (Design)

> **Status: Proposed (not yet implemented).** This is a design/ADR record. Read
> with [memory.md](memory.md) §4 (OpenClaw and Tooling) and
> [code-guidelines.md](code-guidelines.md) §3/§7. No code has changed yet; when
> implemented, fold the durable parts into [memory.md](memory.md) and remove the
> "Proposed" status here.

## 1. Goal

Decouple the reasoning core ("Brain": main graph + swarm) from tool execution so
that tool modules become **independently replaceable** and can run **in
parallel**:

- Replace OpenClaw wholesale with a different backend (e.g. an MCP server, a
  remote sandbox, a mock) without touching any graph/swarm node.
- Run several providers **at once** (e.g. OpenClaw for shell/fs + a dedicated web
  provider + an MCP provider for extra tools), routed transparently behind one
  call seam.

The Brain depends only on an **interface (port)**; every backend is an
**adapter**. This is Ports & Adapters (Hexagonal) plus a **registry/composite**
that fans one logical tool call out to the owning provider.

## 2. Why this is feasible cheaply: there is already one seam

Every tool call in the codebase funnels through a single function,
`openclawRpc(tool, args, options) -> Promise<JsonObject>`. It is imported in
exactly two places:

- `src/swarm/react-worker.ts` — swarm workers' ReAct loop.
- `src/graph/nodes/verify.ts` — main graph `run_tests` (typecheck) call.

That single seam is the natural port boundary. Lifecycle (`startOpenClawGateway` /
`stopOpenClawGateway`, used in `src/main.ts`) is the second seam.

## 3. Current coupling problem

`src/tools/` mixes two unrelated responsibilities:

| Real "tools" (capabilities)                                   | Brain/LLM infrastructure (not tools)         |
| ------------------------------------------------------------- | -------------------------------------------- |
| `local-tools.ts`, `web-search.ts`, `rpc.ts`, `workspace.ts`, `artifacts.ts` | `llm.ts`, `models.ts`, `pricing.ts`, `gateway.ts`, `http.ts` |

`llm.ts` (chat) and the tool path (`/tools/invoke`) both ride the **same**
OpenClaw gateway today. So the gateway is a shared *transport*, not a tool detail.
Keeping it inside a tool adapter would force the LLM layer to depend on that
adapter — the wrong dependency direction.

## 4. The contracts (port)

Three small interfaces live in `src/types/tools/provider.ts` (public contract per
[code-guidelines.md](code-guidelines.md) §3). Argument types are
**provider-neutral** (`ToolArgs`/`ToolCallOptions`, not `OpenClawRpc*`) so the
port never leaks "OpenClaw".

```ts
/* One executable capability, owned by exactly one provider. */
export interface ToolDescriptor {
    readonly id: ToolId;                       // "grep_code" or namespaced "openclaw:grep_code"
    readonly workerKinds: readonly WorkerKind[]; // which swarm roles may request it (module-suggested policy)
    readonly describe?: string;                 // one-line text for the planner prompt
    validate(args: ToolArgs): SanitizedAction;  // arg shaping + planner feedback (Brain-side guard)
    invoke(args: ToolArgs, options?: ToolCallOptions): Promise<JsonObject>; // authoritative execution + guard
}

/* One backend module (OpenClaw, MCP, mock, ...). */
export interface ToolProvider {
    readonly name: string;                      // stable id for telemetry, conflict messages, priority
    readonly catalog: readonly ToolDescriptor[];
    start?(): Promise<void>;                     // own backend lifecycle; OpenClaw reuses shared gateway → no-op
    stop?(): Promise<void>;
}

/* The composite the Brain actually talks to. Implements the same invoke seam. */
export interface ToolRegistry {
    invoke(tool: ToolId, args: ToolArgs, options?: ToolCallOptions): Promise<JsonObject>;
    validate(tool: ToolId, args: ToolArgs): SanitizedAction;
    toolsFor(kind: WorkerKind): readonly ToolId[]; // replaces static WORKER_TOOLS lookup
    describe(kind: WorkerKind): string;            // replaces static prompt tool list
    start(): Promise<void>;                        // fan-out to every provider
    stop(): Promise<void>;
}
```

`ToolId` is a branded string. `ToolName` (the existing `as const` union in
`src/consts/tools.ts`) stays as the **built-in** set the Brain references
directly with compile-time safety (e.g. `verify` → `ToolName.RUN_TESTS`). Every
`ToolName` is assignable to `ToolId`; dynamically-registered tools from external
modules use `ToolId` only. This preserves the project's closed-union safety for
the core path while allowing open extension.

## 5. The registry: parallel + replace from one mechanism

```
            ┌──────────────── BRAIN (main graph + swarm) ────────────────┐
            │  verify, react-worker  →  depend ONLY on ToolRegistry.invoke │
            └───────────────────────────────┬─────────────────────────────┘
                                             │  ToolRegistry (composite)
                         ┌───────────────────┼─────────────────────┐
                         ▼                    ▼                     ▼
                 OpenClaw provider     Web provider          MCP provider
                 catalog: shell/fs/    catalog: web_lookup   catalog: <tools from
                 run_tests/grep/...    (override)            an MCP server>
```

The registry builds a `Map<ToolId, ToolProvider>` from every provider's catalog at
construction. `invoke(tool, ...)` looks up the owner and delegates;
`toolsFor(kind)` / `validate(tool, ...)` / `describe(kind)` are derived from the
merged catalog. From this one mechanism:

- **Replace entirely** = register only the new provider.
- **Run in parallel** = register several; the registry routes per tool id.

### Conflict resolution (two providers offering the same id)

Configurable policy, chosen at registry construction:

- `strict` (**default**): duplicate id at registration → throw. Forces an explicit
  decision. Safest default, matches the project's fail-at-build-not-runtime ethos.
- `priority`: each `ToolProvider` carries a priority; highest wins, the rest are
  shadowed. Use to override OpenClaw's `web_lookup` with a better web provider.
- `namespaced`: ids are always qualified (`openclaw:grep_code`,
  `mcp:grep_code`) so collisions cannot occur; the planner addresses the qualified
  id. Most flexible, slightly more verbose for the model.

### Lifecycle

`registry.start()` / `stop()` fan out to every provider
(`Promise.all(providers.map(p => p.start?.()))`). Each provider owns its own
backend. The OpenClaw provider's lifecycle is a no-op because the shared gateway
is started by the transport/LLM layer (always needed for `callLlm`); a fully
independent provider (e.g. spawning an MCP server) implements real `start/stop`.

## 6. Dependency injection — mirror the existing HITL pattern

The project already injects a non-serializable dependency (the HITL resolver) via
`configurable` + `readHitlResolver(config)`, keeping it **out of checkpointed
graph state** (`src/main.ts`, `src/graph/nodes/swarm-node.ts`). Reuse it verbatim:

- `src/main.ts` builds the registry once and passes it in
  `configurable[TOOL_REGISTRY_CONFIG_KEY]` alongside the HITL resolver.
- Main graph nodes that call tools (`verify`) read it via
  `readToolRegistry(config)` — `buildMainGraph()` stays parameterless.
- The swarm is already rebuilt per invocation inside `swarmNode`, so pass the
  registry by **closure**: `buildSwarm(registry)` → workers close over it →
  `runReactWorker(state, kind, registry)`. No need to thread `config` through the
  ReAct internals.

This keeps the documented invariant intact: **the tool layer is never serialized
into graph state.**

## 7. Safety envelope maps cleanly onto the port (defense-in-depth, §7)

| Guard                                   | Side       | Where it lives after the split                    |
| --------------------------------------- | ---------- | ------------------------------------------------- |
| Which role may request which tool       | Brain      | `registry.toolsFor(kind)`, optionally narrowed by a Brain-side policy override (`src/tools/policy.ts`) |
| Arg shaping + planner feedback          | Per-tool   | `ToolDescriptor.validate()` — moved next to the tool that owns it (replaces the big switch in `swarm/tool-validation.ts`) |
| Workspace path bound (`resolveWorkspacePath`) | Adapter | inside each fs/exec descriptor's `invoke()`; runs **always**, authoritative |
| Shell allowlist re-check                | Adapter    | inside the exec descriptor's `invoke()`; authoritative |
| Shared contract (`ToolName`, `ToolStatus`, `SAFE_DIRECT_EXEC_COMMANDS`) | Shared | stays defined once in `src/consts/tools.ts` |

The two independent layers (Brain-side `validate` + adapter-side authoritative
guard) now sit on opposite sides of the port, which strengthens — not weakens —
the existing defense-in-depth.

## 8. Target folder layout

```
src/
  transport/                 shared OpenClaw gateway client (lifecycle + HTTP)   [Full scope]
    gateway.ts  http.ts  errors.ts
  llm/                       Brain model layer (callLlm, models, pricing)        [Full scope]
    llm.ts  models.ts  pricing.ts  index.ts
  tools/
    registry.ts              ToolRegistry (composite): build map, route, fan-out lifecycle
    config.ts                TOOL_REGISTRY_CONFIG_KEY, readToolRegistry(config)
    policy.ts                optional Brain-side role→tool narrowing/overrides
    index.ts                 barrel + createDefaultToolRegistry()
    openclaw/                first adapter (a replaceable module)
      index.ts               createOpenClawProvider(): ToolProvider
      descriptors/           one file per tool: id, workerKinds, validate, invoke
        grep-code.ts  find-files.ts  ast-read.ts  shell-exec.ts  run-tests.ts  web-lookup.ts
      workspace.ts  artifacts.ts
    mcp/                      future example adapter (catalog from an MCP server)
  types/tools/
    provider.ts              ToolDescriptor, ToolProvider, ToolRegistry, ToolId
    rpc.ts                   ToolArgs, ToolCallOptions, JsonObject (neutralized names)
```

Barrels, concrete `.ts` imports inside a subsystem, and "constants once in
`src/consts/*`" rules from [code-guidelines.md](code-guidelines.md) §1/§3 all
still apply.

## 9. Scope tiers (incremental, each independently shippable)

- **Tier 1 — single swappable provider.** `ToolProvider` port + DI + move
  rpc/local-tools/web-search/workspace/artifacts into `src/tools/openclaw/`.
  `ToolName` set stays static and Brain-owned. Lowest risk; lets you *replace*
  OpenClaw but not yet run providers in parallel.
- **Tier 2 — parallel providers (the requested target).** Add `ToolRegistry`
  (composite), per-provider `catalog`, conflict policy, lifecycle fan-out.
  `verify`/swarm call the registry. Worker tool policy can still be the static
  `WORKER_TOOLS` map for built-ins.
- **Tier 3 — fully dynamic catalog.** Descriptor-driven `toolsFor(kind)` +
  `validate()` + `describe()`; swarm validation and worker tool lists become
  registry-derived; supports namespacing so external modules contribute arbitrary
  tools the planner discovers at runtime.

Tier 2 satisfies "parallel + replace". Tier 3 is only needed once a second module
contributes tools the Brain does not statically know.

## 10. Explicit tradeoff

Tiers 2–3 move part of the tool surface from compile-time closed unions toward a
runtime registry of descriptors. This is a deliberate exchange of some static
guarantees for plugin extensibility. Mitigations: (a) the Brain's hardcoded tool
references (`verify` → `RUN_TESTS`) keep `ToolName` typing; (b) the registry
validates the merged catalog at startup (`strict` conflict policy) so
duplicate/missing-owner errors surface at boot, not mid-run; (c) `ToolId` is
branded to avoid raw-string drift.

## 11. Open questions to resolve before implementing

- Conflict policy default: confirm `strict` vs `priority`.
- Namespacing: bare ids with priority, or always-qualified `provider:tool`?
- Does the main graph (`verify`) ever need a non-OpenClaw `run_tests`, or can it
  stay pinned to a known provider while only the swarm is fully pluggable?
- Where does the planner prompt's tool list come from once catalogs are dynamic
  (`registry.describe(kind)` feeding `WORKER_PROMPTS`)?
- Do we adopt the `transport/` + `llm/` split (Full scope) now, or keep the LLM
  layer in place and only extract the tool subsystem?

## 12. Codex critical review and improved recommendation

The overall direction is right: `openclawRpc()` is the real execution seam, and
moving the Brain from a concrete OpenClaw function to a provider/registry port is
the cleanest way to make tool modules replaceable. The plan is implementable, but
several details should be tightened before coding so the refactor does not
accidentally create a plugin-shaped version of the same coupling.

### 12.1 Strong parts to keep

- Keep the Brain-facing call surface small. `verify` and `runReactWorker` should
  call one injected tool runtime, not import provider-specific modules.
- Keep tool runtime objects out of LangGraph checkpointed state. Reusing the HITL
  `configurable` pattern for main-graph nodes is the correct non-serializable
  dependency injection path.
- Keep the defense-in-depth split. Planner-side validation is useful feedback;
  provider-side execution guards remain authoritative.
- Keep Tier 1 and Tier 2 separate. First prove that the default OpenClaw path can
  be replaced behind an interface, then add multiple providers and routing.

### 12.2 Main weak spots

1. **The OpenClaw gateway is a runtime dependency, not a tool provider detail.**
   The current plan says the OpenClaw provider lifecycle can be a no-op because
   the shared gateway is started by the LLM layer. That works only while
   `callLlm()` still depends on OpenClaw. If tools are replaced and the model
   layer later stops using OpenClaw, the CLI should not start OpenClaw just
   because the old lifecycle is hardcoded in `main.ts`.

   Better: introduce an application runtime boundary first:
   `createAppRuntime({ llm, tools })`, or at minimum split `src/tools/gateway.ts`
   and `src/tools/http.ts` into a neutral `src/openclaw-runtime/` or
   `src/transport/openclaw/` module. Both the OpenClaw LLM adapter and OpenClaw
   tool provider can depend on that runtime, with idempotent start/stop. Startup
   should validate the tool catalog before starting providers, then start
   runtimes/providers in order and stop them in reverse order.

2. **Provider descriptors should not self-authorize worker access.**
   `ToolDescriptor.workerKinds` is useful metadata, but external providers should
   not decide which Brain roles may use them. A malicious or over-broad provider
   could grant `infra_ops` a dangerous tool by declaring it available.

   Better: make the effective permission layer Brain-owned:
   `ToolAccessPolicy.allowedTools(kind, catalog)`. Provider descriptors can
   declare capability tags (`read_workspace`, `exec_allowlisted`,
   `external_network`, `write_workspace`) and suggested roles, but the registry
   applies a Brain-side policy before tools reach prompts or validation.

3. **Conflict policy needs logical aliases, not only duplicate-id handling.**
   `strict`, `priority`, and `namespaced` are useful modes, but they do not fully
   answer replacement. The Brain should be able to keep asking for the stable
   logical tool `web_lookup` while config binds that alias to
   `openclaw:web_lookup`, `tavily:web_lookup`, or `mcp:web_lookup`.

   Better: separate `ToolAlias` from provider-native `ToolId`:
   - Built-in Brain references use stable aliases: `find_files`, `grep_code`,
     `ast_read`, `shell_exec`, `web_lookup`, `run_tests`.
   - Provider catalog ids are qualified: `openclaw:grep_code`,
     `web:tavily_search`, `mcp:filesystem_read`.
   - Registry config maps aliases to provider ids. Duplicate provider ids are
     still an error, and alias rebinding is explicit.

   This gives replacement without prompt churn and parallel providers without
   silent shadowing.

4. **"Parallel providers" is routing, not automatic fan-out execution.**
   The registry should normally route one logical tool call to one selected
   provider. If the desired behavior is "query several web/search providers and
   merge results", that should be modeled as a separate aggregate provider or
   descriptor (`web_lookup` aggregator), not as generic registry conflict
   behavior. Otherwise retries, errors, idempotency, and result ranking become
   unclear.

5. **`artifacts.ts` and workspace guards should not live under
   `tools/openclaw/`.**
   `storeArtifact()` is used by the worker after any provider returns a result;
   it is Brain/runtime infrastructure, not OpenClaw-specific. Likewise,
   `resolveWorkspacePath()` is a shared safety primitive for any local provider,
   not only the OpenClaw adapter.

   Better:
   - Move artifact storage to `src/artifacts/` or `src/runtime/artifacts.ts`.
   - Move workspace policy to `src/workspace/` or `src/runtime/workspace.ts`.
   - Let local providers import those primitives, while remote providers enforce
     their own sandbox boundaries.

6. **Tool result shape needs a compatibility contract.**
   The current port returns `Promise<JsonObject>`, but `verify` depends on
   `extractToolStatus(report)` and shell workers treat non-zero exits as evidence.
   If another provider implements `run_tests` with a different shape, the Brain
   may misread it.

   Better: keep a provider-neutral `ToolResult` envelope for every invocation:
   `status`, `details`, optional `content`, provider metadata, and raw provider
   payload. Built-in aliases like `run_tests` and `shell_exec` must preserve
   `ToolStatus` plus exit-code semantics. Dynamic tools can still return a
   `JsonObject`, but it should sit inside the envelope instead of replacing it.

7. **Error handling should become structured before multiple providers.**
   `classifyFailure()` currently string-matches errors for "gateway",
   "timeout", "permission", etc. That is brittle once MCP, web, local, and remote
   sandbox providers all produce different messages.

   Better: providers throw a `ToolError` with `kind` values such as
   `validation`, `policy`, `timeout`, `environment`, `provider_unavailable`, and
   `execution`. Swarm routing can classify HITL vs reasoning failures from the
   structured kind, with the current message text only used for operator context.

8. **Dynamic prompts can break prompt-cache assumptions.**
   `WORKER_PROMPTS` are currently stable cache anchors. If
   `registry.describe(kind)` is interpolated directly into the system prompt on
   every run, every provider config change busts the worker system prompt and
   makes parser/prompt contracts easier to drift.

   Better: keep stable worker system prompts and append an `AVAILABLE_TOOLS`
   section to the worker user context, or introduce a deterministic
   `renderToolCatalogForWorker(kind)` that is treated as runtime context rather
   than core role prompt copy. Tool descriptions should be short, schema-like,
   and policy-filtered to avoid overwhelming the planner.

9. **The current `ToolName` set mixes logical tools and provider implementation
   helpers.**
   `TAVILY_SEARCH` and `WEB_SEARCH` are not Brain-facing tools; they are
   implementation details inside `web_lookup` fallback. Keeping them in the same
   const union as `run_tests` and `grep_code` makes the future catalog harder to
   reason about.

   Better: split constants into:
   - `BuiltInToolAlias` or existing `ToolName` for Brain-visible logical tools.
   - Provider/internal names under provider-specific consts
     (`OpenClawToolName`, `WebSearchBackendName`, etc.).

10. **"External folder" should mean an import boundary first, filesystem
    location second.**
    Moving files outside `src/` too early adds package/tsconfig/export-map work
    without proving the seam. The important thing is that the Brain imports only
    `ToolRuntime`/`ToolRegistry`, not where the OpenClaw adapter lives.

    Better incremental path:
    - Start with `src/tools/providers/openclaw/` or
      `src/tool-providers/openclaw/`.
    - Once the provider contract is stable, move it to
      `packages/openclaw-tool-provider/` or another external module and import it
      through the same factory.

11. **The plan under-specifies tests and migration checks.**
    This refactor touches safety and execution, so it needs targeted smoke/unit
    coverage before moving files:
    - default registry exposes exactly the current built-in aliases;
    - duplicate provider ids fail in strict mode;
    - alias rebinding can replace `web_lookup` without changing worker code;
    - worker policy rejects unapproved tools even if a provider advertises them;
    - `run_tests` preserves current verification status/exit-code behavior;
    - fake provider can replace OpenClaw for `verify` and ReAct without starting
      the OpenClaw tool path;
    - shell allowlist and workspace escape guards still reject unsafe input.

12. **Trusted-code boundary must be explicit.**
    A provider module is executable code. A registry interface does not sandbox a
    malicious provider. If future providers are untrusted, they should be reached
    through a constrained remote protocol such as MCP or a sandboxed subprocess,
    not imported as a local TypeScript module with full process access.

### 12.3 Better default design

Use four layers instead of letting the registry carry all concerns:

1. **Runtime layer:** starts/stops external processes and transports
   (`OpenClawRuntime`, future MCP process runtime, remote sandbox client). It is
   idempotent and independent of Brain graph state.
2. **Provider layer:** exposes qualified tool descriptors and authoritative
   execution guards. It may depend on a runtime, workspace policy, and env.
3. **Registry layer:** validates catalogs, resolves aliases to qualified provider
   ids, invokes the selected provider, records provider metadata, and enforces
   structured result/error contracts.
4. **Brain policy layer:** filters the registry catalog per worker kind, renders
   the available tool list, and performs planner-facing validation before
   execution.

This keeps provider extensibility while preserving the core invariant: the Brain
decides what workers may ask for; providers decide how their own capabilities
execute safely.

### 12.4 Recommended migration order

The current Tier list is directionally good but should start with a lower-risk
"facade" step before moving files.

0. **Neutralize names without moving behavior.**
   Rename public tool-call types from `OpenClawRpcArgs`/`OpenClawRpcOptions` to
   provider-neutral aliases (`ToolArgs`, `ToolCallOptions`) while keeping the
   existing implementation underneath. Split Brain-visible `ToolName` from
   internal web/OpenClaw helper names if possible.

1. **Introduce `ToolRuntime` as a facade over current `openclawRpc()`.**
   Add `createDefaultToolRuntime()` that delegates to the existing function.
   Inject it into `verify` via `configurable` and into swarm through a
   `buildSwarm({ tools })` factory. No file moves yet. This proves DI and
   checkpoint behavior with minimal blast radius.

2. **Move validation to descriptors, but keep Brain-owned access policy.**
   Convert the current `sanitizeToolArgs()` switch into descriptor validators for
   the built-in aliases. `ToolAccessPolicy` replaces the static `WORKER_TOOLS`
   lookup as the effective role gate.

3. **Add registry with explicit alias binding.**
   Register only the OpenClaw provider first. Then add one fake/mock provider in
   tests to prove wholesale replacement. After that, add a second real provider
   such as dedicated web search to prove parallel provider routing.

4. **Physically extract the OpenClaw provider.**
   Move provider-owned files into `src/tool-providers/openclaw/` or
   `src/tools/providers/openclaw/`. Keep `callLlm`, pricing, and model routing
   outside the tool provider. Move artifacts/workspace safety to shared runtime
   owners, not under OpenClaw.

5. **Only then consider package-level extraction.**
   When the interface stabilizes, move the provider to an external package or
   top-level module folder. This is the point where "replace OpenClaw with a
   different module" becomes a packaging concern rather than a graph refactor.

### 12.5 Suggested contract sketch

```ts
export type ToolAlias = ToolName;
export type QualifiedToolId = `${string}:${string}`;

export type ToolCapability =
    | "read_workspace"
    | "write_workspace"
    | "exec_allowlisted"
    | "external_network";

export type ToolErrorKind =
    | "validation"
    | "policy"
    | "timeout"
    | "environment"
    | "provider_unavailable"
    | "execution";

export interface ToolResult {
    readonly status: ToolStatus;
    readonly provider: string;
    readonly toolId: QualifiedToolId;
    readonly alias?: ToolAlias;
    readonly details?: JsonObject;
    readonly content?: string;
    readonly raw?: JsonObject;
}

export interface ToolDescriptor {
    readonly id: QualifiedToolId;
    readonly aliases?: readonly ToolAlias[];
    readonly capabilities: readonly ToolCapability[];
    readonly description: string;
    validate(args: ToolArgs): SanitizedAction;
    invoke(args: ToolArgs, context: ToolCallContext): Promise<ToolResult>;
}

export interface ToolAccessPolicy {
    toolsFor(kind: WorkerKind, catalog: readonly ToolDescriptor[]): readonly ToolAlias[];
    validate(kind: WorkerKind, alias: ToolAlias, args: ToolArgs): SanitizedAction;
}

export interface ToolRegistry {
    invoke(alias: ToolAlias, args: ToolArgs, context: ToolCallContext): Promise<ToolResult>;
    describeFor(kind: WorkerKind): string;
    start(): Promise<void>;
    stop(): Promise<void>;
}
```

The exact names can change, but the separation matters: aliases are stable
Brain-facing commands, qualified ids are provider-facing implementation names,
policy is Brain-owned, and results/errors are structured enough for verification,
HITL, telemetry, and artifacts.

### 12.6 Decision recommendation

For the final architecture, prefer:

- strict provider-id uniqueness;
- explicit alias binding for replacing built-in logical tools;
- qualified ids for dynamic external tools;
- Brain-owned access policy over provider-owned worker authorization;
- stable worker system prompts plus runtime tool catalog context;
- structured `ToolResult`/`ToolError` before adding a second real provider;
- `OpenClawRuntime` shared by the OpenClaw LLM adapter and OpenClaw tool
  provider, rather than starting OpenClaw directly in `main.ts`;
- artifact and workspace safety modules outside the OpenClaw provider.

This path still reaches the original target: OpenClaw can be replaced wholesale,
other providers can run in parallel, and the Brain depends only on a stable tool
interface. It also avoids making external providers more powerful than the
Brain's own policy layer.
