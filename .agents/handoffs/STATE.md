---
phase: "R"
phase_status: in_progress
plan_path: docs/superpowers/plans/2026-06-10-boilerplate-refactor.md
active_task: ""
active_status: ""
baseline_sha: ""
r0_keys_rotated: true
updated_at: 2026-06-11T10:20:00Z
updated_by: claude
next_action: "R5 complete (feat 67bc12c structured outputs + profile-injected cascade prompts; baseline efd78f1; NO review-fix commit — Codex review verdict 0 P1/0 P2/0 P3, fix+re-review legs skipped per chain). ./verify --fast + npm test green; 207 unit tests (+27). Live: pure-reasoning task on direct all-Haiku profile ($0.005049, RunSummary written) + probe confirmed native jsonSchema parsed object end-to-end. R4 json_object 400 backlog finding FIXED in-session (all json_object prompts now say 'Return ONLY this JSON'). DeepSeek stays on text fallback (D6 feature gate); swarm ReAct structured migration + swarm profile propagation remain backlog. Next: R6 — Profiles + CLI surface + example profiles (personal-dev/research-playground/client-baseline.json5, --profile/--resume CLI polish, README), via 'виконай сесію R6'. Read STATE.md, plan Task R6 + Standing rules, spec §3.2 (profile contract; example profile sketches in its Notes) ; mind: AGENT_PROFILE env selection already exists in src/cli/config.ts (loadActiveProfile), profiles need pricing entries for every model id, direct bindings need bare ids, and profiles may now pin prompts.cascadeNote."
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
Codex review: 1 P1 + 1 P2 confirmed-fixed, re-review CLOSED.

R5 is complete (2026-06-11): structured outputs + prompt de-cascading landed
(feat `67bc12c`; baseline `efd78f1`; no review-fix commit — Codex verdict
0/0/0). Zod decision schemas (`src/types/graph/decisions.ts`) mirror the
parser contracts; the direct transport honors `structuredSchema` natively for
Anthropic/OpenAI (`withStructuredOutput`, method jsonSchema, includeRaw;
OpenAI strict; DeepSeek text-fallback per D6); parse sites prefer
`result.parsed` over the verbatim text ladder; cascade prose is now profile
data (`prompts.cascadeNote`, memoized composition, `promptsForConfig`);
json_object prompts all mention "JSON" (closes the R4 live-400 finding).
Next R-session is R6 (Profiles + CLI surface). Ordering rules still hold:
never run two sessions concurrently in this pilot.
