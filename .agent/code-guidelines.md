# Code Guidelines — `ai-agents-assitant`

Working rules derived from the 2026-06-06 refactor audit. They complement
[guidelines.md](guidelines.md) (LangGraph/TypeScript rules) — read both. The goal
is a codebase where a scalar is defined once, a helper exists once, each file has
one job, and the type checker catches mistakes the runtime would otherwise hide.

> Hard rule before any commit: `npm run typecheck` **and** the smoke suite
> (`npm run smoke`, currently react/patch/HITL/websearch/verify-report/logging)
> pass.

---

## 1. Constants — no magic scalars

Every tool name, model reference, model role, OpenClaw control identifier
(Gateway endpoints, session keys, agent ids), graph node name, telemetry key,
tool status, env-var name, worker status/kind, and tuning threshold lives
**once** in [src/consts/](../src/consts/) and is reused. Inline string/number
literals for these are forbidden — a typo'd node name or `usageStats` key fails
silently at runtime instead of at compile time.

- Runtime values are grouped by concern:
  `consts/models.ts`, `consts/openclaw.ts`, `consts/tools.ts`,
  `consts/graph.ts`, `consts/worker.ts`, `consts/usage.ts`,
  `consts/env.ts`, `consts/tuning.ts`, and `consts/web.ts`.
- Each closed runtime group is an `as const` object paired with a same-named
  union type in the same [src/consts/](../src/consts/) module: `ToolName`,
  `ModelRef`, `ModelRole`, `MainNode`, `SwarmNode`, `UsageKey`, `ToolStatus`,
  `EnvVar`, `OpenClawControl`, `WorkerStatus`, `FailureType`, `WorkerKind`.
  Import annotation-only unions with `import type` from `src/consts/*`; if a
  module uses the symbol as both a runtime value and a type, use one normal
  `src/consts/*` import. There is no separate `src/types/consts/*` layer.
- `ModelRef` values **must** stay byte-equal to the keys in
  [src/consts/pricing/model-pricing.json](../src/consts/pricing/model-pricing.json)
  (the cost lookup is keyed on them).
- Tuning knobs are named constants with a one-line rationale
  (`CONFIDENCE_ESCALATION_THRESHOLD`, `DEFAULT_COST_BUDGET_USD`, the
  `PROJECTED_*` budget figures, the `MAX_*` loop caps).
- Legitimately literal exceptions: prompt copy that *documents* a tool/command to
  the model, user-facing error-message text, and pure type annotations
  (e.g. `responseFormat?: "json_object"`).

## 2. No duplication — shared helpers live once

Cross-cutting helpers belong in [src/shared/](../src/shared/):
[json.ts](../src/shared/json.ts) (`extractJsonObject`, `asRecord`),
[text.ts](../src/shared/text.ts) (`readString`, `readNumber`, `clampInt`,
`clamp01`, `truncate`, `safeJson`, `stringifyPretty`, `stringifyError`,
`errorMessage`), [usage.ts](../src/shared/usage.ts)
(`emptyUsage`/`mergeUsage`/`usageFromLlm`/`mergeUsageStats`).

Before hand-rolling a coercion/stringify/merge helper, check `shared/` first.
The usage 7-field shape is defined **once** in
[src/types/usage.ts](../src/types/usage.ts) (`LlmUsage`/`UsageBreakdown`) —
never re-list those fields inline.

## 3. One responsibility per file; public API via barrels

- Aim for cohesive modules under ~200 lines. The historical monoliths
  (`tools/openclaw.ts`, `main.ts`, `swarm.ts`) are split by concern:
  `tools/*` (gateway, http, models, pricing, llm, local-tools, web-search,
  artifacts, rpc), `graph/*` (budget, escalation, parsers, context-terms,
  `nodes/<node>.ts`, routing, build), `swarm/*` (tool-validation,
  react-worker, nodes, routing, build), `state/*`, `prompts/*`, `cli/*`.
- The root of `src/` is reserved for:
  - executable entrypoint (`main.ts`);
  - the single public export barrel (`index.ts`).
  Do not add feature modules, domain enums, parsers, patching logic, HITL
  drivers, adapters, or runtime data files directly under `src/`.
- Put files next to their strongest owner:
  - graph orchestration in `src/graph/`;
  - graph node implementations in `src/graph/nodes/`;
  - swarm orchestration, workers, worker routing, and worker validation in
    `src/swarm/`;
  - OpenClaw/Gateway adapters and local pseudo-tools in `src/tools/`;
  - LangGraph state annotations and reducers in `src/state/`;
  - prompt-cache anchors in `src/prompts/`;
  - CLI argument/env/reporting concerns in `src/cli/`;
  - runtime constants in `src/consts/`;
  - shared/public type contracts in `src/types/`;
  - reusable, dependency-light helpers in `src/shared/`.
- Create a new top-level folder only for a real subsystem with multiple related
  files and a stable boundary. Good candidates are domains such as `hitl/`,
  `patching/`, or `domain/worker.ts`; bad candidates are vague buckets like
  `utils/`, `misc/`, or `common/`.
- Runtime data/config files should not be mixed with executable modules unless
  they are private to that module. Project-level runtime constants and data live
  under `src/consts/`; pricing data currently lives at
  `src/consts/pricing/model-pricing.json`.
- File and folder names use lower-kebab-case for multi-word modules
  (`react-worker.ts`, `tool-validation.ts`) and domain-specific nouns over
  implementation trivia. Avoid catch-all names like `helpers.ts`, `manager.ts`,
  `service.ts`, `types.ts`, or `enums.ts` unless the file's owner and boundary
  are unambiguous from its folder.
- Split a file when it starts owning multiple roles, not just when it gets long:
  parsing vs applying vs rollback, resolver types vs stdin resolver vs graph
  driver, worker nodes vs recovery nodes, or gateway lifecycle vs HTTP calls.
- **Barrels** keep the public import surface stable: `src/index.ts` is the
  side-effect-free root barrel. External consumers and smoke scripts import that
  barrel for root-level public API; `src/main.ts` is CLI-only and must not be
  re-exported from `src/index.ts`.
- Every folder root that owns multiple TypeScript modules should expose an
  `index.ts` barrel with explicit named exports. Consumers outside that
  subsystem boundary may import from the folder barrel instead of a concrete
  file when the symbol is part of the folder's public surface. Import the
  owning folder itself, not `/index.ts`.
- **Cycle safety:** modules *inside* a subsystem import each other by concrete
  file, **not** the barrel. A subsystem barrel must not be imported by a file it
  re-exports. Keep dependencies a DAG (shared types in a leaf module, e.g.
  `types/tools/rpc.ts`, `tools/errors.ts`).
- ESM is mandatory: use explicit `.ts` extensions for concrete local TypeScript
  file imports. Import `index.ts` barrels from the owning folder. TypeScript
  uses `bundler` resolution for those folder-barrel specifiers, and
  `rewriteRelativeImportExtensions` rewrites concrete `.ts` imports on emit.

## 4. TypeScript — quality typing

- Prefer a union/`as const` type over `string` wherever the value set is closed
  (`callLlm(role: ModelRole, …)`, not `modelKey: string`).
- Narrow `unknown` with the shared guards (`asRecord`, `readString`, …) instead
  of `as` casts. Reserve `as` for genuine LangGraph generic-inference gaps.
- Build `usageStats` entries with `UsageKey` constants as computed keys so a typo
  is a compile error.
- Switches over a union should be exhaustive through an `assertNever`-style
  terminal branch, never a runtime fallback for a known role/kind; let the
  compiler flag a missing case.
- Use the project const objects (`WorkerStatus`, `FailureType`, `WorkerKind`) for
  control flow, never scattered booleans/strings.
- Keep `tsconfig` strictness (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) green — use `import type`
  for type-only imports.

## 5. Comments — why, not what

- Prefer clearer names, smaller functions, or extracted constants over a comment.
- Add comments only for non-obvious invariants, cost/safety rationale, provider
  quirks, or ordering that would be risky to infer from the code alone.
- Delete comments that restate identifiers, types, control flow, or test cases.
  Module headers are not required unless they explain a boundary the filename
  cannot.
- Use block comments only: `/* concise rationale */`. Multi-line block comments
  are fine when the rationale is genuinely multi-part.
- Do not use `//` comments, decorative section dividers, dashed rule lines, or
  banner comments.

## 6. Prompts are prompt-cache anchors

`SystemPrompts` strings are constants composed in [src/prompts/](../src/prompts/).
Keep each role's text and JSON output contract **byte-identical** unless the
matching parser in [graph/parsers.ts](../src/graph/parsers.ts) /
[swarm/tool-validation.ts](../src/swarm/tool-validation.ts) changes too. Editing
copy busts the cache and can break a parser — change both together, deliberately.

When parsing JSON from model text, use [src/shared/json.ts](../src/shared/json.ts)
instead of ad hoc brace slicing. LLM replies often include prose, code fences, or
extra braces after the object; parser helpers must scan for the first parseable
balanced JSON object and degrade through the existing fallbacks.

## 7. Safety envelope is defense-in-depth — keep it layered

The shell allowlist (`SAFE_DIRECT_EXEC_COMMANDS`), workspace path bound
(`resolveWorkspacePath`), per-worker tool catalog (`WORKER_TOOLS`), and
no-shell-interpolation local adapters are each independent guards. When touching
tools/swarm, preserve all layers; the local OpenClaw adapters remain the
authoritative guard regardless of caller-side checks.

## 8. Memory & task automation (unchanged)

Per [guidelines.md](guidelines.md): update [memory.md](memory.md) (Architecture /
Current Status) and [tasks.md](tasks.md) before completing a task.
Single-developer repo — commit to `main`, no branches/PRs unless asked.
