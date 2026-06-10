# Project Tasks

**Status (2026-06-10):** Boilerplate refactor planned and scheduled (R1–R9).
Review: [docs/reviews/2026-06-10-project-review.md](../docs/reviews/2026-06-10-project-review.md);
spec: [docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md](../docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md);
plan: [docs/superpowers/plans/2026-06-10-boilerplate-refactor.md](../docs/superpowers/plans/2026-06-10-boilerplate-refactor.md).
Sessions run per [.agents/session-protocol.md](../.agents/session-protocol.md)
(trigger `виконай сесію R<n>`); live state in
[.agents/handoffs/STATE.md](../.agents/handoffs/STATE.md).

Use this file for live work only. Current architecture and durable project
context live in [.agent/memory.md](memory.md); engineering rules live in
[.agent/code-guidelines.md](code-guidelines.md). Completed historical milestones
were removed from this tracker during the 2026-06-06 memory/tasks cleanup to keep
future sessions focused on what still needs action.

## Active Tasks — Refactor Schedule (one session each)

- [ ] R0 (owner, manual) Rotate the four leaked API keys in `.env`; set
  `r0_keys_rotated: true` in `.agents/handoffs/STATE.md`. Blocks R1.
- [ ] R1 Test foundation: vitest + characterization tests for pricing,
  budget, routing, parsers; CI node matrix.
- [ ] R2 Profile foundation: zod-validated profiles; role→model bindings
  become data; call-site LLM options move into bindings.
- [ ] R3 Provider seam: ChatProvider interface, direct LangChain transport,
  OpenClaw legacy adapter, retry layer, new model pricing entries.
- [ ] R4 Run kernel: runId, SqliteSaver checkpointer + `--resume`, per-node
  cost/timing logs, RunSummary artifact on all termination paths.
- [ ] R5 Structured outputs (main graph) with text-parser fallback;
  profile-injected cascade prompts.
- [ ] R6 Profile CLI surface + personal-dev / research-playground /
  client-baseline example profiles; README.
- [ ] R7 Bench harness: `runAgentTask` entrypoint + promptfoo provider +
  smoke suite + fixtures; `npm run bench`.
- [ ] R8 Offline e2e on a fake provider + security hardening (patch guards,
  token fallback removal) + exact dependency pinning.
- [ ] R9 Live MVP validation across all profiles; baseline bench report;
  tag `v0.1.0-boilerplate`.

## Backlog

- [ ] Langfuse (v5, OTel path) tracing integration behind the R4 callbacks
  hook; self-hosted; custom DeepSeek pricing in its model table.
- [ ] Declarative topology variants per profile (spec D3 deferral) — only
  after the profile system proves itself in real use.
- [ ] Swarm ReAct step decision → structured outputs (R5 covered the main
  graph only).
- [ ] Decide OpenClaw transport removal once direct-transport parity is
  confirmed by R9 live runs (spec D1).
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
