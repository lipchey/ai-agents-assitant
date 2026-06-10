# Resume Protocol ("продовжуй роботу")

Lets a fresh agent session continue pilot work from a single trigger with no
further prompting. Triggers: "продовжуй роботу", "продовжуй", "continue",
"resume", "continue work". The live pointer is
[handoffs/STATE.md](handoffs/STATE.md) (the single mutable exception to the
append-only handoff policy).

This pilot's batched refactor work runs through
[session-protocol.md](session-protocol.md) (`виконай сесію R<n>`); the
quality-system rollout that adopted `./verify` is driven from the meta repo
(`self-maintaining-system`). This protocol is the lightweight continuation
shape for either, and it sits on top of, not in place of, those protocols.

## State Model

Plan checkboxes in the active plan are the source of truth for `done`;
`STATE.md` only adds the in-flight sub-status a checkbox cannot express.

Per-task states: `todo -> pending -> ready_to_review -> done`.

| State             | Meaning                                        | Stored where                    |
| ----------------- | ---------------------------------------------- | ------------------------------- |
| `todo`            | not started                                    | derived (unchecked, not active) |
| `pending`         | implementation in flight / awaiting its commit | `STATE.md` `active_status`      |
| `ready_to_review` | implementation committed; awaiting review      | `STATE.md` `active_status`      |
| `done`            | reviewed, fixes applied                        | plan checkbox `- [x]`           |

## Session Algorithm (one transition per session)

Read order on every trigger: `AGENTS.md` -> this file ->
[handoffs/STATE.md](handoffs/STATE.md) -> the active plan (ordered checkbox
tasks) -> [memory.md](memory.md), [guidelines.md](guidelines.md),
[code-guidelines.md](code-guidelines.md), [project-facts.md](project-facts.md),
[core-code-guidelines.md](core-code-guidelines.md),
[model-roles.md](model-roles.md) -> latest `handoffs/` note and
`git log baseline_sha..HEAD`.

```text
active = first unchecked task in the plan
if none:                  # plan complete
  run the plan's verification (advisory); record result
  report "plan complete; next plan is owner-driven"; STOP
status = (active == STATE.active_task) ? STATE.active_status : todo

todo:             set pending + baseline_sha=HEAD; implement per the plan
                  and session-protocol.md; commit; set ready_to_review;
                  report; STOP
pending:          if HEAD == baseline_sha: report "waiting for commit" and
                  STOP; else review baseline_sha..HEAD; apply accepted fixes;
                  commit; verify (advisory); check the box; advance; STOP
ready_to_review:  review the task's commits (no wait); apply fixes; commit;
                  verify (advisory); check the box; advance; STOP
```

Exactly one transition per session, so the owner can inspect between steps.

## Review, Verification, Commit

- Review follows [model-roles.md](model-roles.md) (non-author runtime) and the
  P1/P2/P3 conventions in the review guides; R-sessions run the full
  [review-chain.md](review-chain.md).
- Verification is advisory, never blocking: the smallest meaningful check for
  the touched area (`./verify --fast` or `npm test`); red results are reported,
  the owner decides.
- Typing the trigger IS the standing authorization to commit that session's
  implementation, review fixes, plan-checkbox edits, and `STATE.md` updates to
  `main`. It is NOT authorization to push; pushing needs an explicit affirmative
  line in the same message.

## Reconciliation

- Plan checkboxes win every disagreement with `STATE.md`; corrections are
  reported, not fatal.
- `STATE.md` absent -> bootstrap: active = first unchecked task; status
  `ready_to_review` if it already has commits, else `todo`.
- A second window triggering mid-implementation finds `pending` with
  `HEAD == baseline_sha` and waits instead of duplicating work.
- Never run two sessions concurrently in this pilot.
