# R-Session Protocol — Boilerplate Refactor

How one refactor session (`R1`–`R9`) runs. Adapted from the meta-repo's
session protocol. The meta-repo owns `S<n>` numbering for its own quality
sessions; this repo's refactor uses `R<n>` — the triggers are disjoint.

## Triggers

Typed by the owner into a fresh Claude Code (Fable 5) session opened in this
repo (typically a cmux pane running `claude`):

- `виконай сесію R<n>` / `execute session R<n>` / `run session R<n>` —
  execute exactly that session.
- `виконай наступну сесію R` / `next R session` — the first unchecked
  `R<n>` in `.agents/tasks.md`.

Typing the trigger IS the standing authorization to commit that session's
work to `main`. It is NOT authorization to push; pushing needs an explicit
affirmative line in the same message.

## Read first (in order)

1. `.agents/handoffs/STATE.md` — where the previous session stopped.
2. The task `R<n>` in
   `docs/superpowers/plans/2026-06-10-boilerplate-refactor.md` + its
   "Standing rules" preamble.
3. Spec contracts:
   `docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md` §2–§3.
4. `.agents/memory.md`, `.agents/guidelines.md`, `.agents/code-guidelines.md`
   (repo engineering rules — binding), `.agents/project-facts.md`
   (sensitive paths / no-touch zones).

## Execution rules

- One session = one plan task (`R<n>`), executed to its **verification
  boundary**. Do not start the next task even if time remains.
- R0 gate: if `STATE.md` does not record `r0_keys_rotated: true`, stop and
  ask the owner — no session may run on the leaked keys.
- Verification boundary command: `./verify --fast` (live since S6). `npm test`
  (typecheck + lint + unit + smoke) is the legacy/fallback surface.
- Commits: per the plan's pinned messages; commit directly to `main`; no
  branches/PRs; never push without an explicit line.
- Out-of-scope findings: record in `.agents/tasks.md` § Backlog with one
  line of context; do not fix inline.
- Tier time budgets (`quality.json` `budgets`) are NEGOTIABLE, not a wall to
  design around (owner decision, 2026-06-11). If a session sees a change with
  a clear quality payoff that breaks a tier budget — a new check, a
  slower-but-stronger gate — it must PROPOSE it to the owner (one line: what,
  time cost, payoff) instead of silently parking the check in `full` or
  dropping the idea. Approved raises are recorded per the D2 convention in
  the meta repo's `docs/quality-baseline.md`.
- Memory automation (`.agents/guidelines.md`) applies: update
  `.agents/memory.md` when architecture changed; tick the plan checkboxes
  and the `R<n>` line in `.agents/tasks.md`.

## Review (every R-session = `codex-required`)

After the verification boundary is green and commits are made, run the full
chain in [review-chain.md](review-chain.md): Codex review of the session
diff → Opus fix of confirmed P1/P2 → Codex re-review of the delta. Loop cap
per [model-roles.md](model-roles.md) rule 3.

## State updates

Update `.agents/handoffs/STATE.md` frontmatter at every transition:
`active_task: "R<n>"`, `active_status: pending` on start (capture
`baseline_sha` = HEAD before the first commit), `ready_to_review` after the
boundary, then clear `active_*` and set `next_action` when the chain
finishes. Plan checkboxes win every disagreement with STATE.md.

## Session report (final message, mandatory)

```text
Session: R<n> - <title>
Did:     <completed steps, one line each>
Verify:  <command -> pass|fail> per check
Commits: <sha> <message> per commit
Review:  <P1/P2 confirmed-fixed / refuted / needs-human counts; re-review verdicts>
Next:    R<n+1> - <one-line goal>
Prompt:  <copy-paste prompt for the next session: trigger line, repo path,
          files to read first, any owner decision that session needs>
Notes:   <deviations, deferred findings, red checks, open questions>
```

The owner starts the next session by pasting the `Prompt:` block into a new
cmux pane. That block must be self-contained.
