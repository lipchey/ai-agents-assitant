# Project Tasks

**Status (2026-06-08):** MVP complete; no active implementation tasks.
Structured logging and compact verify-report projection now have dedicated
smoke coverage.

Use this file for live work only. Current architecture and durable project
context live in [.agent/memory.md](memory.md); engineering rules live in
[.agent/code-guidelines.md](code-guidelines.md). Completed historical milestones
were removed from this tracker during the 2026-06-06 memory/tasks cleanup to keep
future sessions focused on what still needs action.

## Active Tasks

None.

## Backlog

- [x] RTK local exec optimization review: rejected RTK in the runtime verify path
  after critical review; implemented compact `verificationReport` serialization
  instead. Follow-up review moved the projection to `tools/result-reports`, kept
  head+tail diagnostics, bounded provider-specific fallback fields, and added
  verify-report smoke coverage.
- [x] Pluggable tool providers: implement the port/registry design in
  [tooling-architecture.md](tooling-architecture.md) so tool modules become
  replaceable and can run in parallel behind one `ToolRegistry` seam. Phase 0-2
  landed with default local/web providers and registry DI.
- [ ] Tool-provider hardening: extract `transport/`, `workspace/`, and
  `artifacts/` to their proposed subsystem roots; add fake-provider coverage for
  `verify` + ReAct; broaden replacement coverage beyond the current
  catalog-level alias-rebinding smoke test if needed.
- [x] Structured provider errors: convert local + web executors from
  `OpenClawError` to structured `ToolError` so HITL-vs-reasoning routing relies on
  `ToolError.kind`, not substring matching.
- [ ] Main-graph HITL: wire `interrupt()`-based approval/escalation for the
  reasoning layer. Current HITL is swarm-only.
- [x] Structured logging: implement the consolidated `Logger` design in
  [logging-plan.md](logging-plan.md) (pluggable `LogSink`, child context,
  level/format env config). Closes the empty-DuckDuckGo-fallback warning so
  zero-hit searches are visible without failing the worker.
- [x] Source layout cleanup: keep root `src/` to `index.ts` and `main.ts`,
  with feature code under owning folders and public exports centralized through
  `src/index.ts`.
- [ ] Investigate scored verify loop (hill-climbing): evaluate turning the
  binary `verify` gate (`run_tests`/typecheck pass-fail) into a continuous-score
  loop that keeps the best candidate across attempts, where a measurable
  objective exists (test pass count, runtime, diff size, lint score). Reframes
  the existing `frontierCritic`/debate iteration (`MAX_DEBATE_ITERATIONS`) as a
  scored search with best-so-far memory rather than pass-fail retries. Touch
  points: `src/graph/build.ts`, `src/graph/routing.ts`, `verify` node, and the
  budget guards in `src/graph/budget.ts`. Pattern reference: karpathy/autoresearch
  (edit -> run -> measure objective metric -> keep/discard -> iterate).
- [ ] Investigate autoresearch as a live e2e benchmark: assess pointing the
  dual-graph agent at a self-contained, objectively-scored coding task
  (karpathy/autoresearch `train.py`, graded by `val_bpb`) to get an external
  numeric grade for agent coding quality and exercise the full live path that
  current smoke tests skip. Good fit: single-file scope matches the full-file
  patch format, guarded workspace bounds apply, and the numeric result enables
  cross-model comparison across the cascade. Closes part of the "full live e2e
  still needs credentials/Gateway" gap in [.agent/memory.md](memory.md) section 6.
