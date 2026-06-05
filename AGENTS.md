# AGENTS.md — entrypoint for non-Claude agents (Codex, Antigravity, etc.)

**Welcome to `ai-agents-assitant`!**

This file acts as a thin router. **All core project knowledge lives in `.agent/`** — read it, don't duplicate it here.
(Claude enters through root `CLAUDE.md`, which routes to the same `.agent/` files.)

## Read first (same for every agent)
- `.agent/memory.md` — The architecture of our LangGraph agent (Main Graph vs Swarm Sub-Graph) and the current state of the code.
- `.agent/guidelines.md` — Working rules: strict TypeScript guidelines, LangGraph Annotation usage, and MEMORY AUTOMATION. **Follow every rule in it.**
- `.agent/tasks.md` — Currently open action items for building out the agent framework.
