---
phase: "R"
phase_status: in_progress
plan_path: docs/superpowers/plans/2026-06-10-boilerplate-refactor.md
active_task: ""
active_status: ""
baseline_sha: ""
r0_keys_rotated: true
updated_at: 2026-06-11T09:45:00Z
updated_by: claude
next_action: "R4 complete (feat 1362bc9 run kernel + review-fix 85005a3; baseline 1e05557). Codex review → 1 P1 (resume runId path traversal; now validated at parse/context/writer layers) + 1 P2 (resumed failure summary lost task; recovered via graph.getState) confirmed-fixed → re-review both CLOSED. ./verify --fast green; 180 unit tests; live kill test (SIGINT after complexityRouter → failed summary, $0.001434 partial) and live resume (re-entered thread at swarm, completed, $0.111/0.25) both passed on a direct all-Haiku profile. NEW backlog finding: default-profile live runs 400 at the router ('Prompt must contain the word json' — json_object validation); pre-existing, natural fix in R5. Next: R5 — Structured outputs + prompt de-cascading, via 'виконай сесію R5'. Read STATE.md, plan Task R5 (Steps 5.1-5.7) + Standing rules, spec §3 (D6) + §3.2/§3.3; zod decision schemas mirror the EXISTING parser expectations (do not change field names); direct provider gains withStructuredOutput, openclaw stays text-only; parse sites prefer ChatResult.parsed with the text-parser fallback preserved verbatim (R1 parser tests unchanged); cascade prose in prompts becomes profile-injected (byte-stable per profile). Mind the json_object backlog finding when touching router/firewall prompts."
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
accounted). Codex review: 2 P2 confirmed-fixed, re-review CLOSED.

R4 is complete (2026-06-11): the run kernel landed (feat `1362bc9`, review-fix
`85005a3`; baseline `1e05557`). `src/run/` (new L3 dir; ADR-001 amended +
depcruise/eslint mirrors extended in-session) owns the runId-bearing
`RunContext` (configurable-threaded, validated, in-memory NodeVisit/usage
recorder), `wrapNode` (all 13 main-graph nodes: enter/exit/error logging with
per-node durationMs + costDeltaUsd), and the FROZEN spec-§3.4 `RunSummary`
writer (`reports/runs/<runId>.json` on completed/budget_stopped/failed incl.
SIGINT). Main graph compiles with SqliteSaver (`reports/checkpoints.sqlite`,
thread_id = runId); `--resume <runId>` validates a lowercase UUID, recovers
`originalTask` via `graph.getState`, and fails fast on an unknown checkpoint.
`HITL_THREAD_CONFIG_KEY` → `THREAD_ID_CONFIG_KEY` (one thread_id scalar).
Live: SIGINT kill → failed summary with partial cost; resume → completed.
Codex review: 1 P1 + 1 P2 confirmed-fixed, re-review CLOSED. Next R-session
is R5 (Structured outputs). Ordering rules still hold: never run two sessions
concurrently in this pilot.
