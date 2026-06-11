---
phase: "R"
phase_status: in_progress
plan_path: docs/superpowers/plans/2026-06-10-boilerplate-refactor.md
active_task: ""
active_status: ""
baseline_sha: ""
r0_keys_rotated: true
updated_at: 2026-06-11T08:35:00Z
updated_by: claude
next_action: "R3 complete (feat e7b260d provider seam + review-fix 638dec2; baseline 7a66bf7). Codex review → 2 P2 confirmed-fixed (gateway-prefixed ids rejected on direct bindings; HTTP 408 retried) → re-review both CLOSED, no new issues. ./verify --fast green; 165 unit tests; live direct spot check (all-roles claude-haiku-4-5 profile) answered with $0.001058 accounted. Next: R4 — Run kernel, via 'виконай сесію R4'. Read STATE.md, plan Task R4 (Steps 4.1-4.7) + Standing rules, spec §3.4 RunSummary + D4/D5/D9. R4 creates src/run/ (run-context, node-lifecycle, run-summary) — a NEW top-level src dir, so extend ADR-001 + .dependency-cruiser.cjs + eslint.config.js in the same session (run sits ABOVE models: run-context threads the profile ref; spec says 'L3' in its own numbering — pick the ADR band that satisfies run→models and graph→run edges). Adds @langchain/langgraph-checkpoint-sqlite (SqliteSaver, thread_id=runId, --resume), wraps main-graph nodes with timing/cost-delta logging, writes reports/runs/<runId>.json on success/budget-stop/failure (gitignore reports/)."
---

# Live refactor state

Single mutable pointer for the R1–R9 boilerplate refactor
(`.agents/session-protocol.md`). Plan checkboxes in
`docs/superpowers/plans/2026-06-10-boilerplate-refactor.md` win every
disagreement with this file; this file only adds in-flight sub-status a
checkbox cannot express (`pending` / `ready_to_review`).

Current pilot status (2026-06-10): the quality system is live since S6–S7 —
see `project-facts.md` (Quality System) for the component inventory; CI is live
(S7 Task 10): `quality.yml` runs `--fast` on PRs and `--full` on push +
schedule with red-main tracking, validated by two green main runs. The legacy
`.agent` dir was migrated into `.agents/` in S7 Task 9.

R1 is complete (2026-06-11): the vitest characterization suite landed (commit
`fcaf6fd`, 107 cases over pricing/budget/graph-routing/swarm-routing/parsers),
and the cross-runtime review chain (Codex → Opus fix → Codex re-review) closed
all four P2 findings (fix commit `0c317ee`; two added cases — routeDebate
unaffordable-refetch and unset-budget). Owner confirmed R0 (four provider keys
rotated, `r0_keys_rotated: true`) and the meta-repo Phase 2 (S8) closeout.

R2 is complete (2026-06-11): the profile foundation landed (feat `983b9a4`,
review-fix `7fc6f01`; baseline `708a701`). The `src/models/` subsystem (L2)
holds the zod `Profile`/`ModelBinding` schema + loader and
`resolveBinding`/`readProfile`/`resolveTuning`; `profiles/default.json5`
byte-replicates the prior `modelForRole` switch on the openclaw transport, so the
R1 characterization suite stays green unchanged. `src/tools/models.ts` was
deleted; `callLlm` resolves bindings from the active profile (threaded via
`PROFILE_CONFIG_KEY`, validated at the DI boundary) and fails fast on a
non-openclaw transport. ADR-001 + `.dependency-cruiser.cjs` + `eslint.config.js`
extended for the new L2 dir; `json5`+`zod` exact-pinned. Codex review found 2 P2
(profile-injection validation gap; `direct` transport ignored), both fixed and
re-review-CLOSED. Swarm profile-propagation + `maxReactSteps`/`llmMaxRetries`
consumption were deferred to the backlog.

R3 is complete (2026-06-11): the provider seam landed (feat `e7b260d`,
review-fix `638dec2`; baseline `7a66bf7`). `src/models/` now owns the spec-§3.3
`ChatProvider` contract, the openclaw adapter (gateway HTTP client injected from
the L4 shim — models stays L2), the direct LangChain provider
(ChatAnthropic/ChatOpenAI/ChatDeepSeek; adaptive thinking + output_config.effort
native; no temperature on Fable 5/Opus 4.8/4.7; thinking suppressed via
invocationKwargs when unset; LangChain internal retries off), and the retry layer
(full jitter, 408/429/5xx/timeout/network, budget = tuning.llmMaxRetries).
`callLlm` dispatches by transport and prices raw usage in one place. Bare direct
API ids joined model-pricing.json; the loader rejects gateway-prefixed ids on
effective-direct bindings. Live direct Haiku spot check passed ($0.001058
accounted). Codex review: 2 P2 confirmed-fixed, re-review CLOSED. Next R-session
is R4 (Run kernel). Ordering rules still hold: never run two sessions
concurrently in this pilot.
