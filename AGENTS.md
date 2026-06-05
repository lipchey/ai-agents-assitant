# AGENTS.md — entrypoint for non-Claude agents (Codex, Antigravity, …)

Thin router. **All project knowledge lives in `.agent/`** — read it, don't duplicate it here.
(Claude enters through root `CLAUDE.md`, which routes to the same `.agent/` files.)

## Read first (same for every agent)
- `.agent/guidelines.md` — working rules: always-read files, the on-demand rule table, MEMORY
  AUTOMATION, git commit/push gating, dual-sync, comment style. **Follow every rule in it.**
- `.agent/memory.md` — what we build + architecture/running status.
- `.agent/tasks.md` — currently open action items.
