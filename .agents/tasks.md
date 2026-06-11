# Project Tasks

**Status (2026-06-10):** Boilerplate refactor planned and scheduled (R1–R9).
Review: [docs/reviews/2026-06-10-project-review.md](../docs/reviews/2026-06-10-project-review.md);
spec: [docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md](../docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md);
plan: [docs/superpowers/plans/2026-06-10-boilerplate-refactor.md](../docs/superpowers/plans/2026-06-10-boilerplate-refactor.md).
Sessions run per [.agents/session-protocol.md](../.agents/session-protocol.md)
(trigger `виконай сесію R<n>`); live state in
[.agents/handoffs/STATE.md](../.agents/handoffs/STATE.md).

Use this file for live work only. Current architecture and durable project
context live in [.agents/memory.md](memory.md); engineering rules live in
[.agents/code-guidelines.md](code-guidelines.md). Completed historical milestones
were removed from this tracker during the 2026-06-06 memory/tasks cleanup to keep
future sessions focused on what still needs action.

## Active Tasks — Refactor Schedule (one session each)

- [x] R0 (owner, manual) Rotate the four leaked API keys in `.env`; set
      `r0_keys_rotated: true` in `.agents/handoffs/STATE.md`. Blocks R1.
      Owner-confirmed rotated 2026-06-11.
- [x] R1 Test foundation: vitest + characterization tests for pricing,
      budget, routing, parsers; CI node matrix. Done 2026-06-11 (commits
      `fcaf6fd` + review-fix `0c317ee`); 107+2 cases; `unit` check wired into
      `quality.json` `full` tier. Node-matrix deferred to Backlog (owner decision).
- [x] R2 Profile foundation: zod-validated profiles; role→model bindings
      become data; call-site LLM options move into bindings. Done 2026-06-11
      (commits `983b9a4` + review-fix `7fc6f01`). Added `src/models/` (L2);
      `profiles/default.json5` byte-replicates the cascade on the openclaw
      transport; `callLlm` resolves bindings and merges `binding.params`
      (model-tied temperature/thinking/effort) under per-call options
      (maxTokens/responseFormat); routing caps + escalation threshold are
      profile-resolved. Codex review: 2 P2 confirmed-fixed.
- [x] R3 Provider seam: ChatProvider interface, direct LangChain transport,
      OpenClaw legacy adapter, retry layer, new model pricing entries. Done
      2026-06-11 (commits `e7b260d` + review-fix `638dec2`). `src/models/` gained
      `provider.ts` (seam contract), `providers/{openclaw,direct}.ts`, `retry.ts`
      (backoff + full jitter, 408/429/5xx/timeout/network transient set);
      `callLlm` dispatches by `binding.transport ?? profile.transport.default`
      and keeps cost accounting in one place; bare direct API ids added to
      `model-pricing.json`; loader rejects gateway-prefixed ids on direct
      bindings. Live direct Haiku spot check: answer + $0.001058 accounted.
      Codex review: 2 P2 confirmed-fixed, re-review CLOSED.
- [x] R4 Run kernel: runId, SqliteSaver checkpointer + `--resume`, per-node
      cost/timing logs, RunSummary artifact on all termination paths. Done
      2026-06-11 (commits `1362bc9` + review-fix `85005a3`). Added `src/run/`
      (L3: run-context, node-lifecycle `wrapNode`, run-summary writer) +
      `src/consts/run.ts`; all 13 main-graph nodes wrapped; SqliteSaver at
      `reports/checkpoints.sqlite` with `thread_id = runId`; `--help`/`--resume`
      CLI; spec-§3.4 RunSummary (FROZEN) written on completed/budget_stopped/
      failed incl. SIGINT; README created; `reports/` gitignored;
      `@langchain/langgraph-checkpoint-sqlite` 1.0.3 exact-pinned. Live: SIGINT
      kill → failed summary with partial cost; resume re-entered the thread and
      completed ($0.111/0.25). Codex review: 1 P1 (resume runId path traversal) + 1 P2 (resumed failure summary lost task) confirmed-fixed, re-review
      both CLOSED.
- [x] R5 Structured outputs (main graph) with text-parser fallback;
      profile-injected cascade prompts. Done 2026-06-11 (commit `67bc12c`).
      `src/types/graph/decisions.ts` zod schemas mirror the existing parser
      contracts; direct transport honors `structuredSchema` via LangChain
      `withStructuredOutput(…, { method: "jsonSchema", includeRaw: true })`
      (Anthropic native output_format — composes with thinking; OpenAI
      strict; DeepSeek deliberately on the text fallback per D6); parse sites
      prefer `result.parsed` with the text ladder verbatim (R1 tests
      unchanged). Cascade prose is profile-injected (`prompts.cascadeNote`,
      memoized per note; default profile replicates the pre-R5 prose). All
      json_object prompts now mention "JSON" (closes the R4 backlog 400).
      Live: pure-reasoning direct-Haiku run + native-parsed probe. Codex
      review: 0 P1/P2/P3 — no fix pass needed.
- [x] R6a Model tier layer (added 2026-06-11, runs BEFORE R6): profiles gain
      a required `tiers` block (frontier/adviser/skilled/worker) with `roles`
      as optional per-role overrides; rename `ModelRole.FRONTIER` →
      `REASONER`; `default.json5` migrated byte-equivalently. Spec:
      [docs/superpowers/specs/2026-06-11-model-tiers-design.md](../docs/superpowers/specs/2026-06-11-model-tiers-design.md).
      Done 2026-06-11 (commits `4af2809` + review-fix `41f18ad`). Schema v2
      (strict two-shape override union), `DEFAULT_ROLE_TIER` +
      `resolveBinding` precedence in `src/models/`, ADR-003; default profile
      resolves byte-equivalently (equivalence + precedence + loader-failure
      tests, 217 unit cases green). Codex review: 2 P2 confirmed-fixed
      (full-binding equivalence pinning; DEFAULT_ROLE_TIER contract tests),
      re-review both CLOSED; 1 P3 routed to backlog.
- [ ] R6 Profile CLI surface + personal-dev / research-playground /
      client-baseline example profiles (tier format per R6a); README.
- [ ] R7 Bench harness: `runAgentTask` entrypoint + promptfoo provider +
      smoke suite + fixtures; `npm run bench`.
- [ ] R8 Offline e2e on a fake provider + security hardening (patch guards,
      token fallback removal) + exact dependency pinning.
- [ ] R9 Live MVP validation across all profiles; baseline bench report;
      tag `v0.1.0-boilerplate`.

## Backlog

- [x] (R4 finding) Default-profile live runs fail at `complexityRouter` with
      HTTP 400 "Prompt must contain the word 'json' in some form to use
      'response_format' of type 'json_object'". Fixed in R5 (`67bc12c`):
      every prompt sent with `responseFormat: json_object` (router, frontier
      architect, both critics, leadDelegator) now says "Return ONLY this
      JSON: {…}" — contract braces and parsers unchanged.
- [ ] (R6a review P3, needs-human) `.agents/memory.md` §1 "Project Goal" still
      says "frontier models do the first architecture/review pass" — after the
      R6a tier rename that contradicts ADR-003 vocabulary (first pass =
      reasoner role on the adviser tier; the frontier TIER runs only behind
      escalation gates). One-sentence rewording; chain policy forbids
      auto-applying P3s.
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
- [ ] (R2 deferred) Swarm profile propagation: thread the active profile into the
      swarm sub-graph `configurable` (via `swarmNode` + the swarm driver) so swarm
      `callLlm` bindings and `tuning.maxReactSteps` follow a non-default profile.
      R2 left swarm call sites on `callLlm`'s default-profile fallback (byte-stable
      for the default profile only); `tuning.maxReactSteps` is in the profile
      schema + `resolveTuning` but still unconsumed (react-worker reads the
      `MAX_REACT_STEPS` const). `llmMaxRetries` IS consumed since R3: `callLlm`
      threads `resolveTuning(profile).llmMaxRetries` into every provider call.
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
      still needs credentials/Gateway" gap in [.agents/memory.md](memory.md) section 6.
- [ ] (R1 Step 1.7, owner decision) Multi-Node version matrix for the unit
      tests (engines 22/24/latest): it would live in `quality.yml`, which is
      generated and SHA-pinned — route it through the quality-system change
      process, not an inline edit. The `unit` check currently runs single-Node via
      the `quality.json` `full` tier.
- [ ] (R1 finding) Add a `model-pricing.json` validation guard so an Anthropic
      entry missing `inputCacheHitPer1M` cannot silently bill cache-reads at the
      full `inputPer1M` rate (~10x over-bill). Also add a characterization case for
      the `anthropicRawInputIncludesCacheRead` subtraction branch in
      `src/tools/pricing.ts`, which the R1 suite does not yet cover.
- [ ] (R1 pinned quirks — confirm intended, else fix during R2-R8 with the
      matching test) The R1 characterization suite deliberately locks current
      behavior including: swarm `routeAfterHuman` re-delegating a DONE worker back
      to its worker node instead of short-circuiting to `WORKER_COMPRESS` (unlike
      `routeAfterWorker`); `extractJsonObject` unwrapping a top-level JSON array to
      its first inner object; and several dead/dormant defensive branches (budget
      `readCostBudgetUsd` number-guard + min-remaining clause dormant at the default
      budget; `routeAfterFrontierArchitect` pure-reasoning ternary false-side
      unreachable; `delegateToWorker`/escalation `??` defaults unreachable under
      current types).
