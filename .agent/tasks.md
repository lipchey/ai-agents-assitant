# Project Tasks

**Status (2026-06-07):** MVP complete; no active implementation tasks.

Use this file for live work only. Current architecture and durable project
context live in [.agent/memory.md](memory.md); engineering rules live in
[.agent/code-guidelines.md](code-guidelines.md). Completed historical milestones
were removed from this tracker during the 2026-06-06 memory/tasks cleanup to keep
future sessions focused on what still needs action.

## Active Tasks

None.

## Backlog

- [x] Pluggable tool providers: implement the port/registry design in
  [tooling-architecture.md](tooling-architecture.md) so tool modules become
  replaceable and can run in parallel behind one `ToolRegistry` seam. Phase 0-2
  landed with default local/web providers and registry DI.
- [ ] Tool-provider hardening: extract `transport/`, `workspace/`, and
  `artifacts/` to their proposed subsystem roots; add fake-provider coverage for
  `verify` + ReAct; broaden replacement coverage beyond the current
  catalog-level alias-rebinding smoke test if needed.
- [ ] Main-graph HITL: wire `interrupt()`-based approval/escalation for the
  reasoning layer. Current HITL is swarm-only.
- [ ] Structured logging: emit warnings for empty DuckDuckGo fallback results so
  zero-hit searches are visible without failing the worker.
- [x] Source layout cleanup: keep root `src/` to `index.ts` and `main.ts`,
  with feature code under owning folders and public exports centralized through
  `src/index.ts`.
