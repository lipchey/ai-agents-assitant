# Project Tasks

**Status (2026-06-06):** MVP complete; no active implementation tasks.

Use this file for live work only. Current architecture and durable project
context live in [.agent/memory.md](memory.md); engineering rules live in
[.agent/code-guidelines.md](code-guidelines.md). Completed historical milestones
were removed from this tracker during the 2026-06-06 memory/tasks cleanup to keep
future sessions focused on what still needs action.

## Active Tasks

None.

## Backlog

- [ ] Main-graph HITL: wire `interrupt()`-based approval/escalation for the
  reasoning layer. Current HITL is swarm-only.
- [ ] Structured logging: emit warnings for empty DuckDuckGo fallback results so
  zero-hit searches are visible without failing the worker.
