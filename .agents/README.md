# Agent Knowledge Map

`.agents/` is the canonical checked-in agent-knowledge directory for
`ai-agents-assitant` - project documentation and policy, not private or
generated model memory. Root entrypoints stay thin and route here
(`AGENTS.md` is the primary router; `CLAUDE.md` is the thin Claude Code
adapter). This directory replaced the legacy single-file `.agent` dir in S7.

## Files

- `memory.md` - dual-graph architecture (Main Graph + Swarm Sub-Graph),
  patch/verify behavior, OpenClaw/tooling, current status and backlog.
- `guidelines.md` - LangGraph/TypeScript working rules and memory automation.
- `code-guidelines.md` - project structure conventions: constants, shared
  helpers, module decomposition + barrels, typing, comments, safety envelope,
  logging.
- `core-code-guidelines.md` - the always-applied 80/20 code baseline; the long
  tail belongs to an explicit deep review pass.
- `tooling-architecture.md` - the pluggable tool-provider design (ports +
  adapters + registry); the seam the architecture review guide checks.
- `project-facts.md` - local facts, sensitive paths, no-touch zones, the
  verification surface.
- `architecture-decisions.md` - all accepted decisions (ADR-001 layer DAG,
  ADR-002 knip config); the only decision record.
- `model-roles.md` - the two-runtime seat split (Claude produces, Codex
  reviews) for the R-session refactor.
- `known-false-positives.md` - accepted tool/review false positives; do not
  re-report these.
- `review-guides/` - repo-local review guides loaded by explicit instruction,
  each carrying its own P1/P2/P3 output conventions:
  `architecture-review.md`, `security-review.md`.
- `session-protocol.md` - batched R-session execution ("виконай сесію R<n>").
- `review-chain.md` - the automated in-session cross-runtime review chain run
  at the R-session review boundary.
- `resume-protocol.md` - the "продовжуй роботу" continuation algorithm; live
  pointer in `handoffs/STATE.md`.
- `tasks.md` - live backlog and the R0-R9 refactor schedule.
- `handoffs/` - `STATE.md` (the single mutable live pointer) plus append-only
  handoff notes.

## Directory policy

- `.agents/` is canonical; files here are loaded by explicit instruction from
  the root entrypoints, not assumed to be automatic runtime context.
- Durable knowledge is not duplicated across files; route to the owner file.
  New accepted decisions go to `architecture-decisions.md` as a new ADR.
- `tasks.md` is lightweight backlog only; `STATE.md` is the documented mutable
  exception (resume/session protocols). Overlapping multi-agent handoffs use
  append-only `handoffs/` notes.
- Optional `.claude/rules/` files, if added, adapt this canonical knowledge -
  never a second source of truth.
