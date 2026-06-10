# AGENTS.md - shared entrypoint for Codex and non-Claude agents

Welcome to `ai-agents-assitant`: a dual-graph autonomous development agent
(Main Graph + Swarm Sub-Graph) built with `@langchain/langgraph` in TypeScript.
This file is a thin router; Claude Code enters through `CLAUDE.md`, which
imports this file. Durable project knowledge lives in `.agents/` - read it,
don't duplicate it here.

## Resuming work

If the user says "продовжуй роботу" / "продовжуй" / "continue" / "resume",
follow `.agents/resume-protocol.md`: read `.agents/handoffs/STATE.md`, perform
one transition, stop and report. Batched refactor sessions ("виконай сесію
R<n>") follow `.agents/session-protocol.md`. The trigger is standing
authorization to commit that session's work to `main` (not to push).

## Read first

- `.agents/README.md` - map of the agent knowledge directory.
- `.agents/memory.md` - dual-graph architecture and current code state.
- `.agents/guidelines.md` - LangGraph/TypeScript working rules and memory
  automation. Follow every rule.
- `.agents/code-guidelines.md` - project structure conventions; follow when
  changing code.
- `.agents/core-code-guidelines.md` - the always-on 80/20 code baseline.
- `.agents/project-facts.md` - sensitive paths, no-touch zones, the
  verification surface, gateway-token handling.
- `.agents/architecture-decisions.md` - all accepted decisions (ADR-001 layer
  DAG, ADR-002 knip).
- `.agents/known-false-positives.md` - accepted tool/review false positives.
- `.agents/tooling-architecture.md` - the pluggable tool-provider design.
- `.agents/review-guides/` - architecture and security review guides
  (loaded by explicit instruction).
- `.agents/tasks.md` - live backlog and the R0-R9 refactor schedule; live
  pointer in `.agents/handoffs/STATE.md`.

## Working rules

- Verification = `./verify` scopes: `--staged` (pre-commit hook), `--fast`
  (pre-push hook), `--full`, `--doctor`; `npm test` runs the legacy
  typecheck/lint/smoke chain. Run the strongest available check before
  declaring work done.
- Prefer CodeGraph first for code/project navigation where available.
- To read a **dependency's** source (esp. `@langchain/*`): if `opensrc` is
  available, run `opensrc path <pkg>` and grep/read the returned source
  (lockfile-pinned to the installed version). The returned path may be the
  monorepo root — find the sub-package under `libs/`: e.g. `@langchain/core`
  → `libs/langchain-core`, providers like `@langchain/openai` →
  `libs/providers/langchain-openai`; `@langchain/langgraph` resolves straight
  to `libs/langgraph-core`. If `opensrc` is unavailable (cloud agents, CI,
  other sandboxes) or a package fails to resolve, read the compiled code in
  `node_modules/<pkg>` instead. For _this project's own_ code prefer CodeGraph
  — opensrc is for third-party deps (complementary, not competing). Read
  dependency source via subagents/grep; never dump it into main context.
- Deterministic gates run before AI judgment; never re-report what
  `tsc`/`eslint`/`dependency-cruiser`/`knip`/`gitleaks`/`./verify` already prove
  or what `.agents/known-false-positives.md` accepts.
- Treat `.agents/` as checked-in project knowledge, not private agent memory;
  route to it instead of duplicating durable knowledge. New decisions go to
  `.agents/architecture-decisions.md` as a new ADR.
- Single-developer repo: commit directly to `main` only when the user asks
  (the resume/session triggers are the documented exception). No branches,
  PRs, or pushes unless explicitly requested.
