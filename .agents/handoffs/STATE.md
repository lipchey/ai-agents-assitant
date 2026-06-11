---
phase: "R"
phase_status: in_progress
plan_path: docs/superpowers/plans/2026-06-10-boilerplate-refactor.md
active_task: ""
active_status: ""
baseline_sha: ""
r0_keys_rotated: true
updated_at: 2026-06-11T13:45:00Z
updated_by: claude
next_action: "R7 complete (feat eb8322b, review-fix 05bd335; Codex 2 P2 confirmed-fixed, re-review both CLOSED, 0 new; 1 P3 → backlog needs-human). Next: R8 via 'виконай сесію R8' — fake provider (src/models/providers/fake.ts, deterministic scripted ChatProvider) + offline full-graph e2e (tests/e2e/offline-run.test.ts, three runAgentTask runs on a fake-transport profile) + security hardening (widen PROTECTED_SEGMENTS incl. the quality surface; VERIFY-not-redo the S6/D4 gateway-token fail-fast) + exact-pin openclaw/@langchain/*/typescript + wire an e2e check into the quality.json full tier (tier sum within budget; budgets negotiable — propose raises). Mind: runAgentTask/executeAgentRun live in src/app/ (L7; ADR-001 amendment — NOT src/run/ as the plan sketched); runAgentTask resolves with a status:'failed' RunSummary instead of rejecting (bench provider depends on that and must NOT map it to ProviderResponse.error — promptfoo short-circuits grading); budgetUsd is validated finite>0 at the boundary; workspaceDir is a reserved option accepting only process.cwd() — R8's temp-workspace e2e must land the real workspace seam AND mind that pricing/profile loading read from process.cwd() too; the bench --offline guard in bench/run-bench.mjs has a backlog checkbox to wire it to the fake provider once it exists."
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

R6a is complete (2026-06-11): the model tier layer landed (feat `4af2809`,
review-fix `41f18ad` — tests only; baseline `ba70405`). Profile contract v2:
required `tiers` (frontier/adviser/skilled/worker → `ModelBinding`), `roles`
an optional STRICT override map (full binding | `{ tier, params? }`);
`DEFAULT_ROLE_TIER` + precedence (full override > tier reassign > default
tier, params merge key-by-key) in `src/models/resolve.ts`; ADR-003 records the
decision. `ModelRole.FRONTIER` → `REASONER` (graph node names
frontierArchitect/frontierCritic stay — FROZEN RunSummary §3.4).
`default.json5` migrated byte-equivalently (equivalence pinned by tests;
cascadeNote bytes unchanged; `DEFAULT_CASCADE_NOTE` reworded to tier
vocabulary). Codex review: 2 P2 (test-strengthening) confirmed-fixed,
re-review both CLOSED; 1 P3 (memory §1 wording) → backlog needs-human.
R7 is complete (2026-06-11): the bench harness landed (feat `eb8322b`,
review-fix `05bd335`; baseline `4b8a936`). `src/app/` (new L7 dir, ADR-001
amendment — the plan's `src/run/` placement would invert the DAG) owns
`executeAgentRun` + the public `runAgentTask` (root-barrel export; HITL
pinned off; budget validated finite>0, NOT env-overridable; failed runs
RESOLVE with a status:"failed" RunSummary so bench keeps cost metadata);
`src/main.ts` is a thin CLI over the same kernel (SIGINT via the onRunReady
handle). Bench: promptfoo 0.121.15 exact-pinned; bench/ holds the custom
provider (tsx-registered in-process import of the src barrel; profile
precedence test var > PROFILE > AGENT_PROFILE > default), the 6-task smoke
suite (judge deepseek:deepseek-v4-flash), the mini-ts-repo fixture (one
deliberate type error; per-run copies under gitignored bench/.work/), the
tsc-based programmatic assert, and the `npm run bench` runner →
reports/bench/<timestamp>/{results.json,summary.md}; --offline fails fast
until R8. Repo gates exclude bench (tsconfig/eslint/knip). Live: trivial
filter on research-playground 2/2 at $0.000110; a full coding-task run
validated the fixture→patch→tsc chain and failed honestly on cascade
quality (backlogged). Codex review: 2 P2 confirmed-fixed, re-review both
CLOSED, 0 new; 1 P3 (app↛cli mirror rule) → backlog needs-human.

R6 is complete (2026-06-11): the profile CLI surface landed (feat `277c054`,
review-fix `79380bb`; baseline `6e8898f`). `--profile <name|path>` flag
(precedence: flag > non-blank AGENT_PROFILE > default), `Profile:` line in
the telemetry report, three direct-transport example profiles
(personal-dev / research-playground / client-baseline, tier format, no
pricing additions needed), run-task.sh PROFILE passthrough, README rewrite
(quickstart/profiles/transports/resume), .env.example AGENT_PROFILE; all
four shipped profiles CI-validated (244 unit cases). Live:
`--profile research-playground` completed on direct DeepSeek Flash
($0.000163, profileName in RunSummary + telemetry). Codex review: 2 P2
confirmed-fixed (conditional gateway startup via `effectiveTransports` +
`ToolRegistry.requiresGateway`; `--resume` recovers the original profile
from its RunSummary), re-review both CLOSED, 0 new. In parallel the owner
landed `bd79aab`: fast-tier budget 240s + unit/prettier-code checks, and the
negotiable-budgets rule in session-protocol.md.
Next R-session is R8 (fake provider + offline e2e + security hardening).
Ordering rules still hold: never run two sessions concurrently in this pilot.
