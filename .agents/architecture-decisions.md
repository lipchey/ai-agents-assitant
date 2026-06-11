# Architecture Decisions - `ai-agents-assitant`

Accepted architecture decisions for the pilot. Each entry is numbered, dated,
and immutable once accepted; supersede rather than rewrite. The executable
mirror of ADR-001 lives in `.dependency-cruiser.cjs` (authoritative) and the
`eslint-plugin-boundaries` block of `eslint.config.js` (advisory).

## ADR-001: Layered import DAG for `src/`

### Status

Accepted - 2026-06-10. Owner-approved (decision D3) on the basis of the Gate 0a
dependency measurement (session S5).

### Decision

`src/` is organized as a strict, acyclic layer DAG. A module may import only
from STRICTLY LOWER layers, from its own layer (siblings), and from external
packages. The one intra-layer rule is inside L6: `graph -> swarm` is allowed,
`swarm -> graph` is forbidden.

| Layer | Dirs / modules                                       | May import from                                         |
| ----- | ---------------------------------------------------- | ------------------------------------------------------- |
| L0    | `src/consts`                                         | (nothing in `src/`) - the universal sink                |
| L1    | `src/types`                                          | L0                                                      |
| L2    | `src/shared`, `src/models`                           | L0-L1 (+ L2 siblings)                                   |
| L3    | `src/state`, `src/logging`, `src/prompts`, `src/run` | L0-L2 (+ L3 siblings)                                   |
| L4    | `src/tools`, `src/hitl`                              | L0-L3 (+ L4 siblings)                                   |
| L5    | `src/patching`                                       | L0-L4                                                   |
| L6    | `src/swarm`, `src/graph`                             | L0-L5; `graph -> swarm` allowed, NEVER `swarm -> graph` |
| L7    | `src/cli`, `src/main.ts`, `src/index.ts`             | L0-L6                                                   |

Type-only edges (`import type` / `export type`) are in scope: the layering
governs the type graph as well as the value graph.

### Rationale

This DAG is the MEASURED graph, not a hypothesis. The Gate 0a battery cruised
the source with full TypeScript resolution (`moduleResolution: bundler`,
extensionless barrels) and `tsPreCompilationDeps` so type-only edges were
visible. The measurement showed 0 file-level cycles and that every observed
directory-level edge was legal under this table EXCEPT two flagged type-only
edges (resolved below).

Deviations from the original draft hypothesis (the 5-band L0-L4 sketch in
`project-facts.md`): the measured reality is an 8-band DAG (L0-L7). The biggest
corrections are:

- `src/types` is NOT co-equal with `src/consts` at the bottom. `consts` is the
  true universal sink (L0); `types` sits one band above it (L1) because several
  type modules legitimately depend on `consts` enums/literals.
- The old "base" band (L1) collapsed `shared`, `state`, `prompts`, `logging`
  together. Measurement splits `shared` (L2) below `state`/`logging`/`prompts`
  (L3), because the latter import `shared`.
- `patching` is its own band (L5) between capabilities (L4) and orchestration
  (L6), rather than sharing the capabilities band.
- The `graph -> swarm` / never `swarm -> graph` direction is confirmed by
  measurement and is the only allowed intra-band edge.

### Resolution of the two flagged edges

Both flagged edges were TYPE-ONLY and both were FIXED in source (no runtime
change, behavior preserved, typecheck/lint/smoke green). Neither needed a
documented exception.

1. `types -> state` (a `types <-> state` two-cycle at the directory level).
   `src/types/graph/state.ts` defined `GraphStateValue = typeof GraphState.State`
   and therefore reached UP into `src/state` for the runtime `GraphState`
   annotation, while `src/state` legitimately reaches DOWN into `src/types` for
   `DebateEntry` / `ToolCallRecord`. Fix: `GraphStateValue` now lives next to
   the annotation it derives from, in `src/state/graph-state.ts`, and is
   exported from `src/state`. The 14 consumers (graph nodes, routing, budget,
   context-terms, cli/report) import it from `src/state`; the now-empty
   `src/types/graph/state.ts` was deleted. `src/types` no longer imports any
   higher layer.

2. `types -> prompts`. `src/types/prompts.ts` re-exported
   `SystemPromptKey = keyof typeof SystemPrompts` from `src/prompts`, an upward
   edge. The plan's candidate (define the key in `src/types`) was rejected
   because the key is intrinsically derived from the runtime `SystemPrompts`
   object and a hand-written union would silently drift. Fix instead: the type
   stays where its runtime source is (`src/prompts`, re-exported from
   `src/index.ts`), and the redundant `src/types/prompts.ts` re-export (which
   nothing consumed via the types barrel) was deleted.

### Enforcement

`dependency-cruiser` is AUTHORITATIVE. It runs as `npm run arch` and as the
`architecture` check in the `fast` tier of `quality.json` (so on
`./verify --fast` and in CI), over `src/**/*.ts` with `.dependency-cruiser.cjs`.
Rule severities:

- `no-circular` -> error (module/file-level import cycles).
- layer rules `layer-L0..L6` and `swarm-no-graph` -> error.
- `not-to-unresolvable` -> error (guards the bundler resolver config; a healthy
  run reports 0 `couldNotResolve` internal imports).
- `no-orphans` -> warn (starts advisory per plan; may be promoted later).

A healthy baseline run reports 107 modules, 336 dependencies, 0 errors, and 2
warnings (the orphan false positives below). The check is blocking on errors
only; zero error findings is the contract.

The layer rules are a CLOSED enumeration. Adding a new top-level `src/` dir
therefore requires updating, together: this ADR's layer table, the depcruise
layer regexes in `.dependency-cruiser.cjs`, and the eslint mirror in
`eslint.config.js`. Until that is done, the catch-all guard rules
`unlayered-src-outgoing` / `unlayered-src-incoming` (severity error) fail loudly
in both directions, so an unlayered dir cannot import or be imported with zero
violations.

`eslint-plugin-boundaries` (in `eslint.config.js`) MIRRORS the same layer rules
for in-editor feedback ONLY. It is wired at `warn` severity, so it surfaces as
editor squiggles and in `eslint .` output but never fails lint or
`./verify --fast`; it is NOT a verify gate. It resolves the project's
extensionless TypeScript imports via `eslint-import-resolver-typescript`. The
two tools are complementary: dependency-cruiser is the gate but, with
`tsPreCompilationDeps`, does not trace pure type-only RE-EXPORTS
(`export type { X } from "..."`); the boundaries mirror does see those, so it
provides earlier, broader feedback at the cost of being advisory. The eslint
mirror shares the same closed-enumeration design (one element per known dir) and
stays advisory (warn-only), so depcruise remains the only gate: it is the catch-all
guard rules there, not in eslint, that turn an unlayered dir into a hard failure.

### Known false positives

- `no-orphans` flags `src/types/state/graph.ts` and `src/types/state/swarm.ts`.
  These leaf type modules are reachable only through the type-only re-export
  barrel `src/types/state/index.ts`, an edge dependency-cruiser's
  `tsPreCompilationDeps` does not trace. They are genuinely reachable in
  TypeScript (typecheck is green and uses them). Accepted as warn-level FPs; do
  not delete. If the orphan rule is promoted to error later, exempt these two
  paths with a dated note here.

### Amendment 2026-06-11 (R2): `src/models` added at L2

Session R2 introduced the profile subsystem `src/models` (Profile/ModelBinding
zod schema + loader, binding/tuning resolution). It sits at L2 beside `src/shared`
because it imports only L0 (`consts`) and external packages (`zod`, `json5`,
`@langchain/langgraph` types) - never a higher layer. Per the closed-enumeration
rule above, this was added together to all three sources in the same session: this
table (L2 row), `.dependency-cruiser.cjs` (`LAYER_DIRS`, `aboveL0`/`aboveL1`, and
the `layer-L2-shared` rule now matching `^src/(shared|models)/`), and the
`eslint.config.js` mirror (`boundariesElements`, `L2`, and the `shared`/`models`
allow rule). `./verify --fast` (depcruise) stays green: `src/tools` and
`src/graph` consume `src/models` as a legal downward L4/L6 -> L2 edge. The old
`src/tools/models.ts` (`modelForRole` switch) was deleted; its bindings now live in
`profiles/*.json5` resolved through `src/models`.

### Amendment 2026-06-11 (R4): `src/run` added at L3

Session R4 introduced the run kernel `src/run` (the runId-bearing `RunContext`
threaded via `configurable`, the `wrapNode` node-lifecycle timing/cost-delta
wrapper, and the `RunSummary` builder/writer). It sits at L3 beside `src/state`/
`src/logging`/`src/prompts`. In practice it imports only L0 (`consts`), L2
(`shared`), and its L3 sibling `src/logging` - plus external packages
(`@langchain/langgraph` types, `node:crypto`/`node:fs`/`node:path`) - never a
higher layer; the L3 policy additionally permits L1 (`types`), L2 (`models`), and
the `state`/`prompts` siblings. It is consumed DOWNWARD by `src/graph` (L6 ->
L3: `build.ts` wraps every main-graph node with `wrapNode`) and by `src/main.ts` /
`src/cli` (L7 -> L3: runId / checkpointer / `RunSummary` wiring), both legal
edges. Per the closed-enumeration rule above, this was added together to all three
sources in the same session: this table (L3 row), `.dependency-cruiser.cjs`
(`LAYER_DIRS`, `aboveL0`/`aboveL1`/`aboveL2`, and the `layer-L3-base` rule now
matching `^src/(state|logging|prompts|run)/`), and the `eslint.config.js` mirror
(`boundariesElements`, `L3`, and the L3 allow rule). `./verify --fast` (depcruise)
stays green. R4 also renamed the lone `HITL_THREAD_CONFIG_KEY` scalar (value
`"thread_id"`) to `THREAD_ID_CONFIG_KEY` in the new `src/consts/run.ts`, so one
`thread_id` definition is shared by the main-graph SqliteSaver checkpointer and the
swarm HITL driver.

## ADR-002: Knip dead-code config and report-only baseline

### Status

Accepted - 2026-06-10 (session S7, Task 8). `knip.json` is comment-free JSON, so
this entry is the canonical "why" for every config switch. Knip runs as the
`dead-code` check in the `full` tier of `quality.json` in **report-only** mode:
it never fails `./verify --full` (only `blocking` checks do), it prints the
JSON-reporter finding set to the run log, and the committed snapshot lives at
`quality-baselines/knip.json`. The runner does NOT diff baselines; the baseline
is a human-read reference for future drift, not a gate. Note that
`quality.json`'s `policy.block_new_dead_code_only: true` is forward-looking and
currently has no runtime effect on the `dead-code` check - the runner treats the
check as unconditionally report-only regardless of that flag.

### Config decisions (`knip.json`)

Tuning goal (plan language): "findings are real signal". A no-config knip 6.x run
reported 2 unused files, 3 unused deps, 1 unused devDep, 107 unused exports, and
69 unused types - the export/type counts being almost entirely barrel
re-export noise. The tuned config reduces this to the real signal below.

- `project: ["src/**/*.ts", "scripts/**/*.ts"]`. Scopes knip to first-party
  source. WHY: the default project glob swept in `tools/verify-runner.mjs` - the
  vendored quality-runner bundle, invoked by the `verify` bash shim, never
  `import`ed - and flagged it as an unused file (a false positive on an
  off-limits file we must not touch). Narrowing `project` drops it cleanly while
  leaving `scripts/` in scope so `scripts/gateway-smoke.ts` stays a true finding.

- `entry: ["src/main.ts", "src/index.ts", "src/*/index.ts", "src/types/*/index.ts"]`.
  The first two are the plan-named application entries (also auto-detectable, but
  pinned for clarity). The two `*/index.ts` globs are the BARREL-HANDLING switch
  and the core of the tuning: marking the public layer barrels as entry surface
  tells knip their re-exports are intentional public API, so the 162-ish barrel
  re-export findings disappear WITHOUT blanket-ignoring whole directories. The
  globs are deliberately layout-matching rather than the broad `src/**/index.ts`:
  `src/*/index.ts` covers the 12 first-level layer barrels (including
  `src/types/index.ts`) and `src/types/*/index.ts` covers the 6 type sub-barrels.
  Deep, non-pure provider index files like `src/tools/providers/web/index.ts`
  (and `src/tools/providers/index.ts`, `src/tools/providers/local/index.ts`,
  `src/graph/nodes/index.ts`) are intentionally NOT entry surface, so their
  exports are knip-visible like any other module rather than being auto-excused
  as public API. This introduces no new findings today - the committed baseline
  is byte-identical under the tightened globs (verified by regenerate + diff),
  which proves those deep index files currently export nothing dead. Real dead
  exports in non-barrel files stay visible (see baseline). This is why, e.g.,
  `getGatewayToken` is NOT a finding: it is alive (used in `src/tools/gateway.ts`
  and imported deep by `scripts/websearch-smoke.ts`); only its barrel re-export
  edge was unused, which is exactly the noise this switch removes. The same is
  true for the `PROJECTED_*_USD` budget consts and `ModelProvider`, which have
  real deep-path consumers.

- Plan note vs. measured reality: the plan's draft Files list suggested
  `scripts/*.ts` as an entry. That was deliberately NOT applied, because making
  every script an entry would suppress `scripts/gateway-smoke.ts` - the one
  unwired script the plan explicitly wants kept as a finding. Of the seven
  `smoke:*` scripts in `package.json` (plus the `smoke` aggregate), six wire a
  distinct `scripts/*-smoke.ts` file via `tsx` (`smoke:offline` and `smoke` just
  recompose those six), and knip auto-detects those file paths; `gateway-smoke.ts`
  (which has no npm-script wiring) therefore remains the sole unused-file finding.
  This is the plan's sanctioned "adjust from measured findings".

- No dependency ignores. `openclaw` is flagged as an unused dependency because it
  is consumed as a CLI binary outside npm scripts, not as an imported module; it
  is KEPT as a baseline finding and MUST NOT be removed (owner-routed decision).
  The three Task-7 devDeps (`dependency-cruiser`, `eslint-plugin-boundaries`,
  `eslint-import-resolver-typescript`) are correctly detected as used via knip's
  built-in eslint/dependency-cruiser plugins reading `eslint.config.js` and
  `.dependency-cruiser.cjs`; no ignore or plugin override was needed.

### Committed baseline findings (`quality-baselines/knip.json`)

The tuned, deterministic finding set (stable across repeated runs):

- 1 unused file: `scripts/gateway-smoke.ts` - TRUE positive (no `smoke:gateway`
  npm script). Wire-it-or-delete-it is an owner decision, out of scope here.
- 3 unused dependencies: `@langchain/anthropic`, `@langchain/openai` (TRUE
  positives), `openclaw` (kept by design, see above).
- 1 unused devDependency: `@types/ws` - TRUE positive.
- 2 unused exports + 1 unused type: `readToolStatus` (`src/tools/results.ts`),
  `normalizeLogValue` (`src/logging/fields.ts`), `CreateToolRegistryOptions`
  (`src/tools/registry.ts`). Each is used inside its own file but its `export`
  is consumed nowhere else - genuine "export keyword unnecessary" signal.

A small number of exports that are ONLY re-exported through a barrel and have no
deep-path consumer (e.g. `OpenClawRpcArgs`/`OpenClawRpcOptions`, the
`NPM_RUN_*`/`TSC_NO_EMIT_COMMAND` consts) are absorbed by the barrel-as-entry
switch and do not appear. This is an accepted, intentional trade: the plan's
priority is killing the 162-finding barrel noise while keeping non-barrel dead
exports visible, and these symbols are barrel surface. A future tightening pass
(narrowing which barrels are entries, or moving to a barrel-specific switch) can
recover them if desired.

Maintainer refresh procedure: regenerate the committed baseline with
`./node_modules/.bin/knip --reporter json > quality-baselines/knip.json`, then
`prettier --write quality-baselines/knip.json` so it is formatted with the repo
`.prettierrc.json` config (the committed file is `printWidth: 120` JSON; running
prettier without the repo config defaults to `printWidth: 80` and will NOT
reproduce it). Do this after any change that legitimately alters the finding set
(new/removed dead code, config retuning), and review the diff before committing
so unexpected findings or positional churn are caught.

### Baseline stability caveat

The verbatim JSON reporter output embeds `line`/`col`/`pos` positions for each
finding. Because the runner does not diff baselines, this is harmless today, but
a future baseline-diff feature should normalize away positional fields (or
re-emit the baseline) to avoid churn when unrelated edits shift line numbers.
