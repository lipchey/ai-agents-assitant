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

| Layer | Dirs / modules                            | May import from                                         |
| ----- | ----------------------------------------- | ------------------------------------------------------- |
| L0    | `src/consts`                              | (nothing in `src/`) - the universal sink                |
| L1    | `src/types`                               | L0                                                      |
| L2    | `src/shared`                              | L0-L1                                                   |
| L3    | `src/state`, `src/logging`, `src/prompts` | L0-L2 (+ L3 siblings)                                   |
| L4    | `src/tools`, `src/hitl`                   | L0-L3 (+ L4 siblings)                                   |
| L5    | `src/patching`                            | L0-L4                                                   |
| L6    | `src/swarm`, `src/graph`                  | L0-L5; `graph -> swarm` allowed, NEVER `swarm -> graph` |
| L7    | `src/cli`, `src/main.ts`, `src/index.ts`  | L0-L6                                                   |

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
