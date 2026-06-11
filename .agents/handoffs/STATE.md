---
phase: "R"
phase_status: in_progress
plan_path: docs/superpowers/plans/2026-06-10-boilerplate-refactor.md
active_task: ""
active_status: ""
baseline_sha: ""
r0_keys_rotated: true
updated_at: 2026-06-11T06:59:13Z
updated_by: claude
next_action: "R2 complete (feat 983b9a4 profile foundation + review-fix 7fc6f01; baseline 708a701). Codex review → 2 P2 confirmed-fixed → re-review both CLOSED, no new issues. ./verify --fast green (typecheck/lint/smoke-offline/secret-scan/architecture); 128 unit tests, R1 characterization suite unchanged. Next: R3 — Provider seam, via 'виконай сесію R3'. Read STATE.md, plan Task R3 (Steps 3.1-3.8) + Standing rules, spec §3.3 ChatProvider/ChatCallOptions/ChatResult + §3.1 module map. R3 adds src/models/provider.ts + providers/{direct,openclaw}.ts + retry.ts and makes callLlm a thin shim that dispatches by binding.transport (the R2 fail-fast transport guard in callLlm is the natural dispatch point to replace); adds claude-fable-5 + claude-haiku-4-5 pricing entries; @langchain/anthropic|openai become load-bearing + add @langchain/deepseek. Consider wiring the deferred swarm profile-propagation (tasks.md backlog) while in callLlm."
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
consumption are deferred to the backlog. Next R-session is R3 (Provider seam).
Ordering rules still hold: never run two sessions concurrently in this pilot.
