# Project Tasks

**Status (2026-06-06):** MVP complete; no active tasks. The granular change history
lives in the `.agent/memory.md` Audit Logs (§5–§16). Completed work is grouped by
theme below; remaining ideas are in the Backlog.

## Completed milestones

### Foundation & dual-graph
- [x] Scaffold LangGraph dual-graph architecture; typed Swarm + Graph states.
- [x] Wire LLM APIs through `callLlm`; robust `openclawRpc` wrapper; `src/index.ts` entrypoint.
- [x] Correct OpenClaw Gateway contract (`/v1/chat/completions`, `x-openclaw-model`, lifecycle, artifacts); real `/tools/invoke` for `web_search` + safe local pseudo-tool adapters.
- [x] Rewrite the web search provider to Tavily (primary, rich mode) with a DuckDuckGo (key-free) fallback on any failure — wrapper-driven failover in `src/tools/openclaw.ts`, config + env (see memory §14). Brave was dropped: its API dashboard is geo-blocked in Ukraine.
- [x] Main graph invokes the Swarm sub-graph via explicit state mapping.

### Control flow & safety
- [x] Objective verification via `npm run typecheck`; real `npm test`.
- [x] Bound the context-refetch (`MAX_CONTEXT_FETCHES`) and verify/fix (`MAX_VERIFY_ATTEMPTS`) loops.
- [x] Fix `humanGate` crash; skip typecheck for `pure_reasoning`; guard undefined `compressedContext`; raise `recursionLimit`.
- [x] Replace abstract `tokenBudget` with a real `costBudgetUsd` budget + USD-aware routing.
- [x] Make debate-driven context refetch targeted from `debateSummary`/latest critique.

### Model cost cascade & telemetry
- [x] Add DeepSeek V4 Pro as the low-cost frontier architect/critic layer before Opus/GPT escalation.
- [x] Refresh model pricing; account for cache-hit/miss/write input pricing in telemetry.
- [x] Make Opus calls provider-aware (no temperature, adaptive thinking, effort, `strong-reasoning` routing).
- [x] Finalize `pure_reasoning` from reasoning roles; cache `pricing.json` per process.

### Code quality & maintainability
- [x] Structural refactor (audit §15): centralize all scalars in `src/constants.ts`, dedupe helpers into `src/shared/*`, decompose the three monoliths (`tools/openclaw.ts`, `main.ts`, `swarm.ts`) into single-responsibility modules behind stable barrels, tighten typing (`callLlm(role: ModelRole)`, typed usage keys), and compact comments. Captured the rules in `.agent/code-guidelines.md`. Behavior-preserving: prompts byte-identical, all smoke tests + typecheck green.
- [x] Strict post-refactor review hardening (audit §16): balanced JSON extraction for LLM replies with trailing braces/prose, exhaustive `ModelRole` routing, `UsageKey`-typed telemetry stats, and centralized OpenClaw control identifiers.
- [x] Comment audit (audit §17): remove self-evident/decorative comments, convert retained code comments to `/* ... */`, keep `.env.example` comments minimal, remove dashed dividers, and record comment rules in `.agent/code-guidelines.md`.

### Autonomy, HITL & prompts
- [x] Guarded, opt-in patch application (`applyPatches` + `src/patch.ts`).
- [x] Real HITL channel (checkpointer + caller resume loop) restoring `humanGate` interrupt escalation.
- [x] Centralized per-agent system prompts in `src/prompts.ts`.
- [x] Upgrade Swarm workers + lead delegator to LLM-planned ReAct-style agents (per-step tool/path/command choice) while preserving workspace bounds, command allowlists, no shell interpolation, per-worker caps, and artifact storage.

## Backlog (not scheduled)
- [ ] MAIN-graph HITL: wire `interrupt()`-based approval for the reasoning layer (today only the swarm's environment-failure gate is wired).
- [ ] Logging system: when structured logging is added, emit warnings for empty DuckDuckGo fallback results so zero-hit searches are visible without failing the worker.
