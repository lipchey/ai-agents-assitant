# Core Code Guidelines (80/20 Baseline)

The vital-few code rules every agent applies on every coding task in this
pilot. This is not an exhaustive guide; deeper architecture, large refactors,
and long-tail code smells belong to an explicit deep review pass. The full
engineering rules live in [code-guidelines.md](code-guidelines.md) and
[guidelines.md](guidelines.md); this page is the always-on subset.

## Always

- Name things for intent; prefer smaller single-purpose functions over large
  ones. Aim for cohesive modules under ~200 lines.
- Avoid non-trivial duplication; reach for `src/shared/*` and `src/consts/*`
  before hand-rolling a coercion, merge, or literal.
- Keep imports pointing down the layer DAG. Never add a new upward or
  cross-layer import; `graph -> swarm` is the only allowed intra-band edge
  (ADR-001).
- Prefer pure functions; isolate IO, network, subprocess, and filesystem
  effects at the edges (transport, providers, patching).
- Handle errors explicitly. Surface failures as structured `ToolError` kinds at
  provider boundaries; no silent catch blocks or swallowed failures.
- Tests assert behavior, not implementation; the smoke suite must stay green
  for the change you just made.
- Delete dead code instead of commenting it out.
- Match surrounding style; avoid broad reformatting inside a behavior change.
- Keep public surfaces small: export through barrels only what callers outside
  the subsystem need; internal modules import concrete files.

## Conditional

- SOLID and class-design rigor apply moderately here: this is a TypeScript
  LangGraph service with real seams (providers, registry, state reducers), so
  honor interface boundaries and single responsibility at those seams; do not
  over-abstract one-off script-style helpers.
- Layering rigor (ADR-001) is binding for `src/**`. The depcruise gate proves
  the import DAG; you still own cohesion and reducer purity that it cannot see.
- Prefer a union / `as const` type over `string` wherever the value set is
  closed; build `usageStats` keys from `UsageKey` constants.

## Boundary

Anything beyond this page is reviewed on explicit request. Keeping this baseline
short is what lets it be always-on without becoming noise. Deterministic checks
(`tsc`, `eslint`, `dependency-cruiser`, `knip`, `gitleaks`, `./verify`) come
first; do not hand-review what they already prove.
