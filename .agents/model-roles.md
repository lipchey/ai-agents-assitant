# Model Roles — Refactor Pipeline Seats

Adapted from the meta-repo (`self-maintaining-system`, ADR-008/ADR-011) for
the R1–R9 boilerplate refactor. The invariant is **different runtimes for
producing and reviewing**, not a fixed vendor order. Seats may be swapped
per-task with a recorded reason in the session report.

| Seat                  | Runtime / model                                                      | Used for                                                                    |
| --------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Producer              | Claude Code main session — **Claude Fable 5** (`claude-fable-5[1m]`) | Executes one `R<n>` session end-to-end per `session-protocol.md`            |
| Producer's workhorses | In-session subagents — **Opus 4.8** (`Agent` tool, `model: "opus"`)  | Bulk exploration, well-specified sub-implementations, first-pass checks     |
| Reviewer              | **Codex CLI — GPT 5.5**, headless (`codex exec`)                     | Cross-family review of the session diff; re-review of the fix delta         |
| Fixer                 | In-session subagent — **Opus 4.8** (`Agent` tool, `model: "opus"`)   | Verifies Codex findings against code; implements confirmed P1/P2 with tests |
| Tiebreaker            | Human (owner)                                                        | Anything still open after the loop cap                                      |

Rules (unchanged from the meta-repo):

1. The producer never reviews its own diff as the only check — the reviewer
   seat is a different model family.
2. Rework is confirmed by the reviewer seat, not the producer.
3. Loop cap: at most one fix pass + one re-review per session. Anything
   still open after that is `needs-human`, recorded in the session report
   and `.agents/tasks.md` backlog — never a third agent pass.
