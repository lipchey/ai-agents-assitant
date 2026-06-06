# Project Knowledge Base — `ai-agents-assitant`

> Persistent context for AI assistants. Read first to skip re-scanning the repo. Keep current facts up to date in place.

---

## 1. What this is (Project Goal)

This is an autonomous development and cognitive reasoning agent framework built in TypeScript using `@langchain/langgraph`. 
The primary goal is to handle software development and highly complex cognitive tasks by utilizing a multi-agent debate and escalation protocol. The system ensures high token efficiency by assigning routing and context compression to cheaper models, while reserving frontier models for reasoning, architecture, and critique. 

---

## 2. Architecture

The system is built on a strict separation of orchestration and execution layers using a dual-graph architecture.

### Reasoning Layer (Main Graph)
Handles high-level cognitive work without touching raw execution data.
- **Router (`complexityRouter`):** A pre-filter heuristic that delegates subtasks either immediately (trivial), skips to reasoning (pure reasoning), or routes to the Swarm.
- **Context Firewall (`firewall`):** Passes the Swarm's compressed summary into the reasoning layer and keeps raw tool outputs referenced through artifacts.
- **Model Cost Cascade:** DeepSeek V4 Flash handles cheap routing/compression. DeepSeek V4 Pro now acts as a low-cost frontier layer before the strongest models: `frontierArchitect` produces the first architecture spec, `frontierCritic` performs the first review pass, and deterministic high-risk/low-confidence signals escalate to Opus/GPT only when needed.
- **Cost Budget Guard:** `GraphState.costBudgetUsd` is the real run budget. Main-graph routers compare actual `totalCost` plus projected next-step USD cost against a soft ceiling before paying for context refetches, coder/review loops, strong-model escalation, or SME tie-breaking. `MAX_CONTEXT_FETCHES`, `MAX_VERIFY_ATTEMPTS`, and `MAX_DEBATE_ITERATIONS` remain separate hard safety caps.
- **Cache-Aware Telemetry:** `callLlm` prices cached input tokens when provider/OpenClaw usage reports them. It supports DeepSeek `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, OpenAI `prompt_tokens_details.cached_tokens`, and Anthropic `cache_read_input_tokens` plus cache-write usage. `usageStats` now carries optional input/output/cache token buckets in addition to cost and total tokens.
- **Debate Chamber:**
  - `frontierArchitect`: Drafts the initial architecture/code plan and decides whether a strong-model review is needed.
  - `claudeArchitect`: Runs only on strong-escalation paths to verify or improve the frontier architecture draft.
  - `frontierCritic`: Performs the first critique using a rolling window of debate history (to save tokens).
  - `openaiCritic`: Runs only when the frontier critic or high-risk heuristics require strong-model review.
  - `smeTiebreaker`: Breaks the tie if a maximum debate loop count is reached without consensus.
- **Objective Verification (`verify`):** Tests the finalized code. Consensus != Correctness. An objective gate is needed to test output.

### Execution Layer (Swarm Sub-Graph)
Handles tool execution via the `OpenClaw` RPC bridge.
- **Lead Delegator:** Classifies and routes subtasks to specialized worker agents.
- **Specialized Workers:**
  - `codeExplorer`: Uses safe local `rg` wrappers for file discovery and code grep, with raw outputs stored as artifacts. Debate-driven refetches now receive a targeted subtask built from `debateSummary`/latest critique, and `codeExplorer` derives a focused grep pattern from those critique terms instead of always repeating the default broad pattern.
  - `infraOps`: Runs only allowlisted verification/build commands instead of executing natural-language user text.
  - `webResearcher`: Uses the canonical OpenClaw `web_search` tool through the bridge.
- **SOS Escalation Protocol:** 
  - If a worker fails, it branches based on failure type.
  - `reasoning` failures are escalated to an `smeOracle` powered by DeepSeek V4 Pro, which parses a condensed error essence and responds with advice. Control loops back to the worker.
  - `environment` failures (permissions, missing binaries) are escalated to `humanGate` for manual Human-In-The-Loop resolution.
- **Compressor (`workerCompress`):** Formats output structurally for the Firewall, preserving lossless raw outputs in an artifact store.

---

## 3. Technology Stack

- **Language:** TypeScript (ESM)
- **Framework:** `@langchain/langgraph`
- **Orchestrator Tooling Bridge:** OpenClaw (Internal Module). `src/tools/openclaw.ts` starts/probes a local loopback Gateway when needed, stores Gateway state in `.openclaw_state`, and calls `/v1/chat/completions` with `x-openclaw-model`. Normal calls use `model: "openclaw/default"`; adaptive Anthropic strong-reasoning calls use the configured `strong-reasoning` agent so OpenClaw's agent `thinkingDefault: "adaptive"` reaches the provider runtime. OpenClaw Gateway `/tools/invoke` is used only for tools actually available on that HTTP surface, currently `web_search`. Repository-local pseudo-tools (`run_tests`, `shell_exec`, `ast_read`, `find_files`, `grep_code`) are handled by deterministic local adapters with workspace path bounds, exact command allowlists, no shell interpolation, timeouts, and artifact storage.

---

## 4. Pending / Open Context

- **MVP Reached:** The project has an executable LangGraph `src/index.ts` entrypoint that ensures OpenClaw Gateway readiness, invokes the full graph, and reports final telemetry.
- **Validated locally:** `npx tsc --noEmit`, `npm test`, OpenClaw config validation, and a local `openclawRpc("run_tests")` smoke test pass. Full live end-to-end model execution still depends on valid provider credentials and a reachable OpenClaw Gateway/runtime.
- **Open implementation gap:** The debate loop now produces corrected drafts and runs objective typecheck verification, but it still does not apply generated code patches automatically. If true autonomous file mutation is required, add a guarded patch-application stage with review/verification gates.

---

## 5. Audit Log (2026-06-06) — real USD budget, targeted refetch, cache pricing

**CHANGED — Replaced abstract `tokenBudget`.** `GraphState` now uses `costBudgetUsd` with a default of `$1.00` from `src/index.ts` (override via `AGENT_COST_BUDGET_USD`). Routers stop expensive cycles when actual `totalCost` plus projected next-step cost approaches the budget soft ceiling. The existing hard caps remain unchanged: `MAX_CONTEXT_FETCHES`, `MAX_VERIFY_ATTEMPTS`, and `MAX_DEBATE_ITERATIONS`.

**CHANGED — Debate refetch is targeted.** When a critic sets `needsMoreContext=true`, `buildSwarmSubtask` builds a targeted repository-inspection subtask from `debateSummary` and the latest critique. `codeExplorer` recognizes that targeted subtask and derives a focused safe `rg` pattern from the critique terms, while preserving workspace bounds, artifact storage, allowlisted commands, and deterministic local adapters.

**CHANGED — Cache-hit pricing telemetry.** `ModelPricing` now includes optional cache-hit, cache-miss, and cache-write input rates. `callLlm` accounts for DeepSeek `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, OpenAI `prompt_tokens_details.cached_tokens`, and Anthropic `cache_read_input_tokens`/`cache_creation_input_tokens` usage fields; when cache fields are absent, cost calculation falls back to the previous input/output pricing behavior. Pricing was checked against official provider docs for DeepSeek V4 Flash/Pro, Anthropic prompt caching, and OpenAI `gpt-5.5` cached input.

**Validated locally:** `npx tsc --noEmit` and `npm test` pass after these changes.

---

## 6. Audit Log (2026-06-06) — DeepSeek V4 Pro cost/quality cascade

Reviewed the model architecture for price/quality. DeepSeek V4 Pro is available as `deepseek-v4-pro` on the official DeepSeek API and as `deepseek/deepseek-v4-pro` through OpenRouter/OpenClaw-style provider routing, with 1M context, JSON output, tool calls, and current pricing of $0.435/M cache-miss input and $0.87/M output. This makes it a strong intermediate frontier layer before Opus/GPT-class calls.

**CHANGED — Added DeepSeek V4 Pro frontier layer.** `src/tools/openclaw.ts` now maps a new `frontier` role to `deepseek/deepseek-v4-pro`, with optional LLM call controls for JSON mode, thinking on/off, reasoning effort, and max tokens.

**CHANGED — Main graph now uses a model cascade.** `frontierArchitect` runs before `claudeArchitect`; it can skip Opus for routine work or escalate on low confidence/high-risk signals. `frontierCritic` runs before `openaiCritic`; it can skip GPT when the draft is ready for verification or escalate when stronger review is warranted. The existing objective verification gate remains the final correctness check.

**CHANGED — Swarm recovery is cheaper.** `smeOracle` now uses the `frontier` role instead of the Opus-backed `sme` role, and records usage as `frontierSme`, preserving Opus for main-graph tie-breaking.

**CHANGED — Pricing telemetry refreshed.** Local pricing now reflects current official prices: Opus 4.8 $5/$25 per MTok, Sonnet 4.6 $3/$15, GPT-5.5 $5/$30, DeepSeek V4 Pro $0.435/$0.87, and DeepSeek V4 Flash $0.14/$0.28. This fixes stale cost estimates that previously overcounted Opus and undercounted GPT-5.5 output.

**Validated locally:** `npx tsc --noEmit` and `npm test` pass after the cascade changes. Full live end-to-end model execution still depends on valid provider credentials and a reachable OpenClaw Gateway/runtime.

---

## 7. Audit Log (2026-06-05) — loop/token-burn & bug hardening

Senior audit of the dual-graph framework. Architecture matches the design (cheap models for `router`/`firewall`, frontier for `architect`/`critic`/`sme`; firewall compression; SOS escalation). Fixed the following defects. `tsc --noEmit` passes after all changes.

**FIXED — Unbounded context-refetch loop (token burn + crash).** `routeDebate` checked `needsMoreContext` *before* the iteration cap with no counter, so a critic that kept asking for context looped `swarm → firewall → claudeArchitect(Opus) → claudeCoder → openaiCritic → swarm …`. Earlier `codeExplorer` refetches used deterministic `find_files`+`grep_code`, so repeated fetches could add no new information while paying for another expensive reasoning pass. Worst case (~40+ super-steps) tripped LangGraph's default `recursionLimit` of 25 and threw away telemetry. Fix: added `contextFetches` state counter (incremented in `swarmNode`) + `MAX_CONTEXT_FETCHES = 2`; later updates also made refetches critique-targeted and guarded by `costBudgetUsd`.

**FIXED — Unbounded verify/fix loop.** Patches are never applied to disk, so an objectively failing `npm run typecheck` can never be "fixed" by another coder pass, yet `routeAfterVerify` looped `verify → claudeCoder → … → verify`. Fix: added `verifyAttempts` counter + `MAX_VERIFY_ATTEMPTS = 2`; `routeAfterVerify` finalizes once the cap (or budget) is hit.

**FIXED — `humanGate` crash on every environment failure.** It called `interrupt()`, but the swarm is compiled without a checkpointer and the caller has no resume loop, so `interrupt()` throws and aborts the whole run. Environment failures (missing binary, permissions, gateway/timeout, unreachable `web_search`) are common and all routed here. Fix: `humanGate` now blocks gracefully (`WorkerStatus.BLOCKED` + actionable `escalationResponse`) so the failure detail propagates up through the firewall instead of crashing. NOTE: true HITL still needs a checkpointer + resume loop (related to the open patch-application work).

**FIXED — Meaningless verification for `pure_reasoning`.** `verify` ran `npm run typecheck` even for designs/explanations (no code to compile), producing a misleading "verified" report and a wasted subprocess. Fix: `verify` short-circuits to accept the consensus draft when `complexity === "pure_reasoning"`.

**FIXED — `undefined` fed to Opus architect.** On the `pure_reasoning` path the swarm/firewall never run, so `compressedContext` was `undefined` and interpolated literally as `"Compressed context:\nundefined"` into the architect prompt, degrading output. Fix: that line is now omitted when empty.

**FIXED — `recursionLimit` headroom.** `graph.invoke` now passes `{ recursionLimit: 50 }` so legitimate bounded multi-cycle runs (~22 super-steps worst case) never trip the default-25 ceiling and lose telemetry. The per-cycle caps above remain the real termination guard.

**Known minor:** `usageStats` aliases the swarm's `workerCompress` cost under the `firewall` key. `totalCost`/`totalTokens` totals are still correct; only that per-role breakdown is slightly conflated. Live end-to-end run still depends on valid provider credentials and a reachable Gateway/runtime.

---

## 8. Audit Log (2026-06-06) — Opus adaptive thinking, pure reasoning finalization, usage hardening

**CHANGED — Provider-aware OpenClaw LLM payloads.** `callLlm` now derives provider routing from `modelForRole`; Claude Opus routes omit `temperature`, Anthropic thinking uses `thinking: { type: "adaptive" }` plus `output_config.effort` instead of OpenAI-style `reasoning_effort`, and the configured `strong-reasoning` Gateway agent gives current OpenClaw Chat Completions a real adaptive-thinking path. `strong-reasoning` shares the `main` agentDir so existing portable auth profiles do not need to be duplicated and the historical default agent id remains unchanged.

**CHANGED — Pure reasoning finalizes from reasoning roles.** `pure_reasoning` tasks now finalize from `frontierArchitect` or `claudeArchitect` output and do not pass through the implementation-focused `claudeCoder` prompt.

**FIXED — Anthropic cache accounting guard.** `calculateUsage` treats `input_tokens`/`uncached_input_tokens` as the non-cached Anthropic input when present, and subtracts cache-read tokens from OpenAI-style `prompt_tokens` when needed so cache-read input is not counted twice.

**CHANGED — Pricing cache.** `pricing.json` is read once per process through a module-level cache instead of on every LLM call.
