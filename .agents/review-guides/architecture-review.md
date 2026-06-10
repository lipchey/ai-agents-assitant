# Architecture Review Guide

Repo-local guide for an architecture review of `ai-agents-assitant`, a
LangGraph-style TypeScript multi-agent service (dual graph: Main Graph +
Swarm Sub-Graph). Loaded by explicit instruction, not auto-context. Judge
structure the deterministic gates cannot see; keep findings actionable.

## First rule: do not re-report deterministic findings

`tsc`, `eslint`, `dependency-cruiser`, `knip`, `gitleaks`, and `./verify`
already run. NEVER re-report what they prove. In particular, depcruise
(ADR-001) already proves the import DAG has no cycles and no illegal
cross-layer edges. Accepted false positives in `known-false-positives.md` are
off-limits. Your job is the cohesion, purity, and seam-stability that no static
gate checks.

## Output format

Prioritized, concrete findings:

- `P1` - breaks the layer contract, node semantics, or a public seam in a way
  the gates miss; likely to break agent behavior or future replacement.
- `P2` - concrete correctness or maintainability issue in a boundary.
- `P3` - clarity / cohesion improvement.

Each finding: file path + line when possible, one-line "why it matters", and a
concrete suggested direction. No prose dumps.

## Checklist

### Layer-DAG conformance beyond what depcruise proves

- depcruise proves no illegal edge exists. You check whether a legal edge is in
  the RIGHT layer: does a new symbol belong in the layer it was added to, or was
  it placed there only to dodge the import rule? (Layer table: ADR-001.)
- A new top-level `src/` dir is a closed-enumeration change: it must update
  ADR-001's table, `.dependency-cruiser.cjs`, and the eslint mirror together.
  Flag any new dir that did not.
- `graph -> swarm` is the only allowed intra-band edge. Flag any design that
  pushes shared logic up into `graph` to avoid a `swarm -> graph` edge instead
  of placing it in a lower layer (`shared`, `state`, `types`, `consts`).

### Node responsibility cohesion (`src/graph/nodes`, `src/swarm`)

- Each graph/swarm node should own one decision. Flag a node that routes AND
  mutates AND calls a model, or a router (`routing.ts`, `budget.ts`) that has
  grown business logic that belongs in a node.
- Routing guards and hard caps (`MAX_*`) are safety invariants; flag a new path
  that can bypass a cap or the soft USD budget.
- ReAct worker loop (`react-worker.ts`): the step/failure envelope
  (`MAX_REACT_STEPS`, `MAX_REACT_TOOL_FAILURES`) must bound every path.

### State reducer purity and merge semantics (`src/state`)

- Reducers (`reducers.ts`, `graph-state.ts`, `swarm-state.ts`) must be pure:
  no IO, no mutation of inputs, deterministic merge. Flag a reducer that mutates
  an incoming array/object in place or depends on external state.
- Every mutable channel (arrays, maps) needs an explicit reducer; flag an
  annotation field that accumulates but has last-write-wins semantics by
  accident.
- A fresh `MemorySaver` per swarm invocation isolates HITL checkpoints; flag
  any change that shares a checkpointer across invocations.

### Tool-provider seam stability (`src/tools`, `src/tools/providers`)

- The Brain depends ONLY on `ToolRegistry` by alias; providers are adapters
  (`tooling-architecture.md`). Flag any graph/swarm node that reaches past the
  registry into a concrete provider, transport, or `openclawRpc`.
- Aliases (`ToolName`) are the stable Brain vocabulary; qualified ids
  (`provider:tool`) are provider-facing. Flag a Brain-facing change that leaks a
  qualified id or a raw backend name into prompts.
- Replacement is alias rebinding, not priority shadowing; duplicate qualified
  ids must throw at registration. Flag a design that adds silent shadowing or
  registry fan-out (aggregation must be its own provider).
- Local providers are the authoritative guard for workspace bounds, the exact
  command allowlist, no shell interpolation, timeouts, and artifact storage.
  Flag any caller-side check presented as a substitute for the provider guard.
- Errors must cross the provider boundary as structured `ToolError` kinds, not
  substring-matched text; flag a regression to string matching for HITL-vs-
  reasoning routing.

### Graph-vs-swarm orchestration boundary

- The Main Graph orchestrates and escalates; the Swarm executes. Flag swarm
  internals (worker kinds, tool catalogs) leaking into main-graph nodes, or
  main-graph orchestration logic migrating into swarm workers.
- Public surface: `src/index.ts` is the side-effect-free root barrel; importing
  it must not start the agent. `src/main.ts` is CLI-only and must not be
  re-exported. Flag any new side effect at import time.
