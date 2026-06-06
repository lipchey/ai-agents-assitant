# Project Knowledge Base — `ai-agents-assitant`

> Persistent context for AI assistants. Read first to skip re-scanning the repo. Keep current facts up to date in place.

> **Code layout note (see Audit Log §15):** the source is split into small,
> single-responsibility modules. `src/main.ts`, `src/swarm.ts`, `src/state.ts`,
> `src/prompts.ts`, and `src/tools/openclaw.ts` are now **barrels** that re-export
> from `graph/*`, `swarm/*`, `state/*`, `prompts/*`, and `tools/*`. Centralized
> scalars live in `src/constants.ts`; shared helpers in `src/shared/*`. Symbol
> names referenced below are unchanged; only their files moved. New working rules:
> [.agent/code-guidelines.md](code-guidelines.md).

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
- **Guarded Patch Application (`applyPatches`):** Sits between the debate/tiebreaker and `verify`. OFF unless `patchApplicationEnabled` (env `AGENT_APPLY_PATCHES`). When on, it parses the coder's structured `<<<PATCH file="...">>> … <<<END PATCH>>>` blocks from `currentDraft` and writes the full file contents to disk so `verify` tests the real mutated tree. It is bounded to the workspace, refuses `.git`/`node_modules`, and records pristine backups (`patchBackups`/`patchCreatedFiles`). `finalize` keeps the changes when verification passed and rolls back to the pristine tree when it ultimately failed. When off it is a pure no-op.
- **Objective Verification (`verify`):** Tests the finalized code. Consensus != Correctness. An objective gate is needed to test output.

### Execution Layer (Swarm Sub-Graph)
Handles tool execution via the `OpenClaw` RPC bridge.
- **Lead Delegator:** An LLM classifier (cheap `worker` role → DeepSeek V4 Flash) chooses which worker handles the subtask, seeded by and falling back to the upstream `selectWorkerKind` heuristic. Runs once per swarm invocation.
- **Specialized Workers (LLM-planned ReAct agents):** Each worker runs a bounded ReAct loop — the `worker`-role planner picks ONE tool per step, reads the real observation, and decides the next step (read specific files, follow imports, refine searches), up to `MAX_REACT_STEPS`. The safety envelope is enforced both at the worker (per-kind tool catalog `WORKER_TOOLS`, shell-allowlist pre-check, required-arg/limit validation in `sanitizeToolArgs`) and in the local OpenClaw adapters (workspace path bounds, exact command allowlist, no shell interpolation, artifact storage). Recoverable (reasoning) tool/validation errors are fed back in-loop, bounded by `MAX_REACT_TOOL_FAILURES`. See Audit Log §12.
  - `codeExplorer`: tools `find_files` / `grep_code` / `ast_read`.
  - `infraOps`: `shell_exec` (allowlisted) plus the read tools for inspection; a non-zero exit is reported as a finding, not a worker failure.
  - `webResearcher`: `web_lookup` → a Tavily-primary / DuckDuckGo-fallback failover in `openclawRpc` (see Audit Log §14), not a bare `web_search` proxy.
- **SOS Escalation Protocol:** 
  - If a worker fails, it branches based on failure type.
  - `reasoning` failures are escalated to an `smeOracle` powered by DeepSeek V4 Pro, which parses a condensed error essence and responds with advice. Control loops back to the worker, which now consumes that advice (and any `humanGate` retry guidance) as escalation context in its next ReAct attempt.
  - `environment` failures (permissions, missing binaries, gateway/timeout) escalate to `humanGate`, which calls LangGraph `interrupt()` for a real Human-In-The-Loop pause. The swarm is compiled with a `MemorySaver` checkpointer and the main-graph `swarmNode` runs the caller-side resume loop (`driveSwarmWithHitl` in `src/hitl.ts`). A pluggable `HitlResolver` answers each interrupt: an interactive stdin resolver prompts the operator (retry with guidance, or abort), and a non-interactive auto-abort resolver reproduces the previous graceful-block behavior. `humanGate` ALWAYS interrupts; availability is decided at the resolver, so the swarm graph is identical headless or interactive.
- **Compressor (`workerCompress`):** Formats output structurally for the Firewall, preserving lossless raw outputs in an artifact store.

---

## 3. Technology Stack

- **Language:** TypeScript (ESM)
- **Framework:** `@langchain/langgraph`
- **Orchestrator Tooling Bridge:** OpenClaw (Internal Module). `src/tools/openclaw.ts` starts/probes a local loopback Gateway when needed, stores Gateway state in `.openclaw_state`, and calls `/v1/chat/completions` with `x-openclaw-model`. Normal calls use `model: "openclaw/default"`; adaptive Anthropic strong-reasoning calls use the configured `strong-reasoning` agent so OpenClaw's agent `thinkingDefault: "adaptive"` reaches the provider runtime. OpenClaw Gateway `/tools/invoke` is used for the bundled web search tools — `tavily_search` (primary) and `web_search` (DuckDuckGo fallback); see Audit Log §14. Repository-local pseudo-tools (`run_tests`, `shell_exec`, `ast_read`, `find_files`, `grep_code`) are handled by deterministic local adapters with workspace path bounds, exact command allowlists, no shell interpolation, timeouts, and artifact storage.

---

## 4. Pending / Open Context

- **MVP Reached:** The project has an executable LangGraph `src/index.ts` entrypoint that ensures OpenClaw Gateway readiness, invokes the full graph, and reports final telemetry.
- **Validated locally:** `npx tsc --noEmit`, `npm test`, OpenClaw config validation, and a local `openclawRpc("run_tests")` smoke test pass. Full live end-to-end model execution still depends on valid provider credentials and a reachable OpenClaw Gateway/runtime.
- **Patch application (guarded, opt-in):** The debate loop can now mutate repository files autonomously through the `applyPatches` node (see Audit Log 2026-06-06 below). It is OFF by default; when off, behavior is unchanged except for one no-op node in the path.
- **HITL channel (wired):** The swarm's `humanGate` now uses real `interrupt()`-based escalation (checkpointer + caller resume loop, see Audit Log §11). The remaining related gap is on the MAIN graph: its own HITL escalation (e.g. interrupting the reasoning layer for approval) is not wired — only the swarm's environment-failure gate is. Swarm workers are now LLM-planned ReAct agents (Audit Log §12) that consume `smeOracle`/`humanGate` guidance as escalation context on retry, so the previous "deterministic tool plan" gap is closed.
- **Logging backlog:** When the project gets a structured logging system, make empty DuckDuckGo fallback results visible as warnings. They should not fail the worker by default, but zero-hit fallback searches need observability.

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

---

## 9. Audit Log (2026-06-06) — centralized per-agent system prompts

**CHANGED — Added `src/prompts.ts` as the single source of truth for system prompts.** All 10 LLM-calling nodes now import constant `system` strings from `SystemPrompts` instead of inline literals: main-graph `complexityRouter`, `directResponder`, `frontierArchitect`, `claudeArchitect`, `claudeCoder`, `frontierCritic`, `openaiCritic`, `smeTiebreaker`; swarm `smeOracle`, `workerCompress`. The non-LLM nodes (`firewall`, `codeExplorer`, `infraOps`, `webResearcher`, `leadDelegator`, `humanGate`, `verify`, `finalize`) are deterministic and intentionally have no prompt.

**Each prompt now states the agent's operating context:** the dual-graph environment and global cost-optimization mission, its upstream source and downstream destination in the pipeline, its tool boundaries (reasoning nodes cannot call tools — execution is Swarm-only; only the deterministic workers touch `find_files`/`grep_code`/`shell_exec`/`web_search`), and its exact output contract.

**Two-tier design for cost/efficiency.** A small `CORE` block (identity + universal rules: use-only-given-context, no-tools, be-terse) is prepended to every role. A larger `REASONING_CONTEXT` block (mission + data-flow diagram) is added ONLY to decision-making roles (`complexityRouter`, `frontierArchitect`, `claudeArchitect`, `claudeCoder`, `frontierCritic`, `openaiCritic`, `smeTiebreaker`); the cheap utility roles (`directResponder`, `workerCompress`, `smeOracle`) get `CORE` only so a generic preamble does not dilute instruction-following on small/fast models. Escalation criteria in `frontierArchitect`/`frontierCritic` are intentionally aligned with the deterministic `STRONG_ESCALATION_SIGNALS` in `main.ts` so heuristic and model reinforce each other on the system's biggest cost lever.

**Cache-friendly.** `system` strings are constants; all task/state-specific content stays in the `user` message, so the stable system prefix is prompt-cacheable across repeated same-role calls (debate/verify loops). JSON output contracts were preserved byte-for-byte so the existing parsers (`parseRouterDecision`, `parseFrontierArchitectureDecision`, `parseFrontierCriticDecision`, `parseCriticDecision`) keep working.

**Validated locally:** `npx tsc --noEmit` and `npm test` pass after these changes.

---

## 10. Audit Log (2026-06-06) — guarded autonomous patch application

**CHANGED — Added `src/patch.ts` + the `applyPatches` main-graph node.** The framework can now mutate repository files autonomously instead of only returning draft patches, behind hard guards:
- **Opt-in.** Disabled unless `AGENT_APPLY_PATCHES` is truthy (read in `src/index.ts`, passed as `GraphState.patchApplicationEnabled`). When disabled, `applyPatches` is a no-op and end-to-end behavior is unchanged apart from one extra no-op super-step before `verify`.
- **Structured-only.** Only explicitly delimited `<<<PATCH file="rel/path">>> …full file… <<<END PATCH>>>` blocks are written; free-form prose in the draft never touches disk. `claudeCoder`'s prompt now specifies this format (full file contents, not unified diffs). Later blocks for the same path win.
- **Bounded.** Every target is resolved through the now-exported `resolveWorkspacePath` (workspace escape refused) and `.git`/`node_modules` segments are refused.
- **Reversible.** Pristine pre-run contents are captured in `patchBackups`; newly created files are tracked in `patchCreatedFiles`. The verify/fix retry loop re-enters `applyPatches` without overwriting the original backups (uses an `alreadyHandled` set). `finalize` keeps changes when `verificationPassed`, otherwise rolls back (restore backed-up files, delete created files).

**Flow change.** `routeDebate`, `routeAfterFrontierCritic`, the `openaiCritic` route, and the `smeTiebreaker` edge now target `applyPatches` instead of `verify`; `applyPatches → verify` is a plain edge. `pure_reasoning` never reaches this node (it finalizes from the architects).

**New state fields:** `patchApplicationEnabled`, `patchApplied`, `appliedFiles`, `patchBackups`, `patchCreatedFiles`, `patchReport`. `src/index.ts` prints a `PATCH APPLICATION` report section when present.

**Validated locally:** `npx tsc --noEmit` / `npm test` pass, plus a parse→apply→rollback smoke test confirming workspace-escape and `.git` blocks are skipped, content is written, backups restore originals, and created files are deleted on rollback.

---

## 11. Audit Log (2026-06-06) — real HITL channel (interrupt + checkpointer + resume loop)

**CHANGED — `humanGate` now interrupts instead of blocking.** Restored interrupt-based escalation for swarm `environment` failures. `humanGate` builds a JSON-serializable `HitlInterruptPayload` (failure type, worker kind, subtask, reason, escalation attempt) and calls `interrupt(payload)`. On resume it reads a `HitlResolution`: `abort` → `WorkerStatus.BLOCKED` with the actionable detail (the exact prior graceful-block behavior); `retry` → `WorkerStatus.WORKING` + the human's guidance as `escalationResponse`, routing back through `routeAfterHuman` to the worker. The retry path is bounded by the existing `MAX_ESCALATION_ATTEMPTS`, so `humanGate` can interrupt at most twice per swarm run.

**CHANGED — swarm compiled with a checkpointer.** `buildSwarm()` now compiles with `new MemorySaver()` so `interrupt()` pauses instead of throwing. Each `swarmNode` call builds a fresh swarm + fresh `thread_id`, so checkpoints never leak between runs or between the debate-driven refetches.

**ADDED — `src/hitl.ts` (caller-side channel).** `driveSwarmWithHitl(graph, input, resolver, opts)` is the resume loop: invoke with a `thread_id`; while `isInterrupted(result)`, ask the resolver and resume with `new Command({ resume })`; force a final abort if still paused after a defensive round cap. Resolvers: `autoAbortResolver` (headless default), `createStdinHitlResolver()` (interactive terminal prompt; auto-falls back to abort when stdin is not a TTY). `readHitlResolver(config)` pulls the resolver from `config.configurable.hitlResolver`.

**CHANGED — caller wiring.** `swarmNode(state, config)` now reads the resolver from config and drives the swarm via `driveSwarmWithHitl`. `src/index.ts` builds the resolver (interactive by default; `AGENT_HITL` falsey forces auto-abort) and passes it through `graph.invoke(..., { configurable: { hitlResolver } })` — NOT through graph state, so the non-serializable function never enters a checkpoint.

**Design note.** Availability is handled at the resolver, never at the node. `humanGate` always interrupts; the swarm graph topology is byte-identical headless vs interactive. This keeps the failure detail flowing to the firewall in both modes.

**Validated locally:** `npx tsc --noEmit` / `npm test` pass, plus `scripts/hitl-smoke.ts` (run: `npx tsx scripts/hitl-smoke.ts`) — a real `SwarmWorkerState` graph using the real `humanGate` + real `MemorySaver`/`interrupt()`/`Command` confirms: (1) auto-abort → `BLOCKED` with the failure detail propagated; (2) retry → interrupt payload surfaced to the resolver, guidance threaded to the worker, worker recovers to `DONE`.

---

## 12. Audit Log (2026-06-06) — LLM-planned ReAct swarm workers

**CHANGED — Swarm workers are now bounded ReAct agents instead of fixed tool plans.** `src/swarm.ts` replaced the deterministic `WorkerToolPlan[]` runners (`runWorkerPlan` + hard-coded `find_files`+`grep_code` / single allowlisted `shell_exec` / single `web_lookup`, plus the swarm-side grep-pattern derivation helpers) with a generic `runReactWorker`. Each worker's `worker`-role planner (DeepSeek V4 Flash, JSON mode, temp 0) chooses ONE tool per step, reads the real observation, and decides the next step — so `codeExplorer` can read specific files and follow imports, `infraOps` can inspect before/after a command, and `webResearcher` can refine queries. Bounded by `MAX_REACT_STEPS=6` and `MAX_REACT_TOOL_FAILURES=3`.

**CHANGED — Lead delegator is LLM-driven.** The swarm `leadDelegator` node now calls the `worker` role to classify the subtask into a `WorkerKind`, seeded by and falling back to the upstream `selectWorkerKind` heuristic. Runs once per swarm invocation; escalation routes still return to the worker, not the delegator.

**Safety envelope preserved (defense in depth).** Per-worker tool catalogs (`WORKER_TOOLS`), shell-allowlist pre-checks (now sourced from the exported `SAFE_DIRECT_EXEC_COMMANDS`), and required-arg/limit validation live in `sanitizeToolArgs`; the local OpenClaw adapters remain the authoritative guard for workspace path bounds, the exact command allowlist, no-shell-interpolation, and artifact storage. An out-of-scope tool or bad args returns a recoverable error observation (counted against the failure cap), not a crash.

**Escalation guidance is now consumed.** A worker re-entering after `smeOracle` (reasoning) or `humanGate` (environment retry) reads `escalationResponse` + the prior `rawToolOutput` transcript into its ReAct context, closing the previously-open gap where retries needed an out-of-band fix. Environment failures still break the loop → `humanGate`; a stuck worker (no final, no successful tool call, or repeated failures) → `smeOracle`; both bounded by `MAX_ESCALATION_ATTEMPTS`. A planner-call failure (gateway/timeout) escalates by failure type instead of crashing the run.

**Telemetry.** Each worker records its planner LLM spend under `codeExplorer`/`infraOps`/`webResearcher`, and the delegator under `leadDelegator`, in `usageStats`. A new `worker` model role maps to DeepSeek V4 Flash (temp 0) in `modelForRole`.

**New prompts.** `src/prompts.ts` adds a `WORKER_CORE` base (the ReAct loop protocol + safety rules — explicitly NOT carrying CORE's "you cannot call tools" rule) and four constant, cache-friendly prompts: `leadDelegator`, `codeExplorer`, `infraOps`, `webResearcher`.

**Validated locally:** `npx tsc --noEmit` / `npm test` pass; the HITL smoke test still passes (humanGate + escalation routing intact); and `scripts/react-smoke.ts` (`npm run smoke:react`) pins the guards — per-worker tool restriction, shell-allowlist refusal of non-allowlisted/interpolated commands, required-arg rejection, limit clamping, and `parseReactDecision` act/final/prose-fallback. Full live end-to-end execution still depends on provider credentials and a reachable Gateway.

---

## 13. Audit Log (2026-06-06) — review hardening for patch/HITL/ReAct edge cases

Critical review of changes after `f67704ff23a4f3218575efcd791c7e1df7b3db8e` found and fixed four edge cases:

**FIXED — Patch application no longer verifies an unchanged tree.** When `AGENT_APPLY_PATCHES` is enabled but the coder emits no structured `<<<PATCH>>>` blocks, or all blocks are skipped by guards, `applyPatches` now sets `patchApplicationFailed`, records verification feedback, increments the bounded retry counter, and routes back to `claudeCoder` or finalizes after the cap. It does not run `npm run typecheck` against an unchanged repository and call that success a verified implementation.

**FIXED — Patch writer fails closed on filesystem edge cases.** `src/patch.ts` now distinguishes missing files from unreadable targets (for example directory targets), reports guarded skips for read/write failures, and only records backups/created files after a successful write. Rollback remains scoped to workspace-resolved paths.

**FIXED — Lead delegator fallback is real on model-call failure.** If the LLM delegator call throws, `leadDelegator` now uses the seeded heuristic worker kind instead of aborting the swarm before any deterministic worker can run.

**FIXED — Exhausted swarm escalation ends as `BLOCKED`.** The swarm now routes exhausted escalation paths through an explicit `blocked` node so terminal state is `WorkerStatus.BLOCKED` with an actionable `workerSummary`/`escalationResponse`, not a stale `ESCALATING` state.

**ADDED — Patch smoke coverage.** `scripts/patch-smoke.ts` and `npm run smoke:patch` cover safe apply, workspace/protected/read-failed skips, all-skipped reporting, and rollback.

**Validated locally:** `npm run typecheck`, `npm test`, `npm run smoke:patch`, `npm run smoke:react`, and `npm run smoke:hitl` pass. The `tsx` smoke scripts require running outside the restricted sandbox in this Codex environment because the sandbox denies tsx's IPC pipe (`listen EPERM`).

---

## 14. Audit Log (2026-06-06) — web search: Tavily primary + DuckDuckGo fallback

**CONTEXT — why this needed code, not just config.** Investigated the bundled `openclaw` (`node_modules/openclaw/dist/runtime-C6RIaGHP.js`). The managed `web_search` tool resolves to a SINGLE provider with no per-call provider override (its JSON schema has no `provider` field) and no real runtime failover: its native fallback (a) is DISABLED whenever `tools.web.search.provider` is pinned, (b) only triggers on a `missing_*api_key` (provider unconfigured), not on runtime errors/timeouts/empty results, and (c) uses a fixed, non-configurable auto-detect order. So a genuine "Tavily first, fallback on any failure" cannot be expressed in OpenClaw config alone — it had to be driven from our wrapper.

**CHANGED — `src/tools/openclaw.ts` drives the failover.** The `web_lookup` path no longer normalizes to a bare `web_search`. `openclawRpc` now routes `web_lookup` to `runWebLookupWithFallback`:
- **Primary:** Tavily's dedicated `tavily_search` tool in rich mode (`search_depth: "advanced"`, `include_answer: true`, `max_results: 8`).
- **Fallback (on ANY failure — error/timeout OR empty result):** the generic `web_search` tool, pinned to a provider in config (`FALLBACK_WEB_SEARCH_TOOL`/`FALLBACK_PROVIDER_LABEL`). Emptiness is probed tolerantly by `webSearchResultIsEmpty` (an `answer`/`summary` string or any non-empty top-level/one-level-nested array counts as usable), since providers return different shapes.
- The post+retry loop was extracted into `invokeGatewayTool(tool, args, options)` (was inline in `openclawRpc`); `normalizeToolInvocation` is now just control-arg stripping. The returned object is tagged `searchProvider` (Tavily, or the fallback's reported `provider` id / `FALLBACK_PROVIDER_LABEL`) plus `tavilyFallbackReason` on fallback, for observability; the ReAct worker only stringifies the observation, so differing shapes are safe. If both providers fail, it throws an `OpenClawError` naming both.

**FIXED — empty Tavily wrapper results now fall through.** `/tools/invoke` returns plugin tool results as `{ content, details }`; the human-readable `content` array is non-empty even when `details.results` is empty. `webSearchResultIsEmpty` now evaluates `details` when present, and `scripts/websearch-smoke.ts` stubs that real wrapper shape so empty Tavily responses correctly trigger DuckDuckGo fallback.

**CHANGED — fallback provider is DuckDuckGo, not Brave.** Brave was the original pick, but its API dashboard (`api-dashboard.search.brave.com`) is geo-blocked (HTTP 403) in some regions incl. Ukraine, so an API key cannot be obtained. Switched the fallback to **DuckDuckGo** (provider id `duckduckgo`): a bundled, **key-free** `web_search` provider — no account, no env var, no geo-restriction. It is an experimental HTML scraper (can rate-limit/break), which is acceptable for a last-resort tier that runs only when Tavily fails.

**CHANGED — config + env.** `openclaw.config.json5` enables the `tavily` plugin and pins `tools.web.search.provider: "duckduckgo"` (the fallback tier; DuckDuckGo needs no plugin entry). `.env`/`.env.example` replaced the dead `GOOGLE_SEARCH_CX`/`GOOGLE_SEARCH_API_KEY` (OpenClaw never read them — there is no Google CSE provider) with just `TAVILY_API_KEY`, which the Gateway reads. No key is needed for the fallback.

**NOTE — `tavily_search` exposure.** The primary depends on the Tavily plugin tool being invokable via `/tools/invoke`. If it is ever unavailable, the wrapper degrades gracefully to the key-free DuckDuckGo fallback (never a hard break). To change the fallback provider later, repin `tools.web.search.provider`, add the provider's plugin entry + API key if it needs one, and update `FALLBACK_PROVIDER_LABEL`.

**Validated locally:** `npx tsc --noEmit` / `npm test` pass; `openclaw config validate` reports the config valid; new `scripts/websearch-smoke.ts` (`npm run smoke:websearch`) stubs the `fetch` boundary to pin the real `openclawRpc → runWebLookupWithFallback → invokeGatewayTool` path: Tavily-success (fallback untouched, rich args sent), Tavily-error → fallback, empty-Tavily → fallback, both-fail throw, and missing-query rejection. The existing `smoke:react`/`smoke:patch`/`smoke:hitl` still pass.

---

## 15. Audit Log (2026-06-06) — structural refactor: constants, dedup, decomposition, typing

Behavior-preserving cleanup. No graph topology, routing logic, prompt text, or
safety guard changed; the four smoke tests + `npm run typecheck` stay green, and
`SystemPrompts` is byte-identical across all 14 keys (verified). Working rules
captured in **[.agent/code-guidelines.md](code-guidelines.md)**.

**ADDED — `src/constants.ts`** centralizes every scalar that was inline/duplicated:
`ToolName`, `ModelRef` (byte-equal to `pricing.json` keys), `ModelRole`,
`MainNode`/`SwarmNode` (+ `SWARM_BLOCKED_ROUTE`), `UsageKey`, `ToolStatus`,
`EnvVar` (+ `isTruthyEnv`), `CONFIDENCE_ESCALATION_THRESHOLD` (was `0.72` ×8),
`DEFAULT_COST_BUDGET_USD`, `VERIFY_TYPECHECK_COMMAND`, `RESPONSE_FORMAT_JSON`,
web-search labels. Each `as const` object is paired with a same-named union type;
`callLlm` is now typed `(role: ModelRole, …)`, not `(modelKey: string, …)`.

**ADDED — `src/shared/*`** deduplicates helpers that were hand-rolled in 2–3 files:
`json.ts` (`extractJsonObject`, `asRecord`), `text.ts` (`readString`, `readNumber`,
`clampInt`, `clamp01`, `truncate`, `safeJson`, `stringifyPretty`, `stringifyError`,
`errorMessage`), `usage.ts` (the single `LlmUsage`/`UsageBreakdown` shape +
`emptyUsage`/`mergeUsage`/`usageFromLlm`/`mergeUsageStats`).

**CHANGED — the three monoliths split by responsibility** (largest file now ~200
lines, was 1021). Each former path is a re-export **barrel**:
- `src/tools/openclaw.ts` → `tools/{types,errors,workspace,gateway,http,models,pricing,llm,local-tools,web-search,artifacts,rpc}.ts`. `normalizeToolInvocation` collapsed into `rpc.ts`'s `omitControlArgs`.
- `src/main.ts` → `graph/{types,budget,escalation,parsers,context-terms,routing,build}.ts` + `graph/nodes/<node>.ts` (one node per file; architect/critic pairs share a file).
- `src/swarm.ts` → `swarm/{tool-catalog,tool-validation,react-worker,nodes,routing,build}.ts`.
- `src/state.ts` → `state/{reducers,graph-state,swarm-state}.ts`; `src/prompts.ts` → `prompts/{core,reasoning-prompts,worker-prompts}.ts`; `src/index.ts` slimmed → `cli/{config,report}.ts`.

**Public symbol names are unchanged** (e.g. `buildMainGraph`, `buildSwarm`,
`humanGate`, `parseReactDecision`, `sanitizeToolArgs`, `openclawRpc`, `callLlm`,
`resolveWorkspacePath`, `SAFE_DIRECT_EXEC_COMMANDS`, `GraphState`,
`SwarmWorkerState`), so the smoke scripts and external imports were untouched.

**Convention:** internal modules import each other by concrete file; subsystem
barrels are import-only and never imported by a file they re-export (cycle-safe).

**Validated locally:** `npm run typecheck`, `smoke:react`, `smoke:patch`,
`smoke:hitl`, `smoke:websearch` all pass; grep confirms zero duplicated helpers and
no inline model-ref/tool-name/threshold literals outside `constants.ts`/`pricing.json`.

---

## 16. Audit Log (2026-06-06) — strict post-refactor review hardening

Strict review of the structural refactor in §15. Graph topology and prompt text
remain unchanged; fixes were limited to parser robustness and stronger typing /
constant discipline.

**FIXED — JSON extraction no longer fails on trailing braces/prose.** The shared
`extractJsonObject` helper previously sliced from the first `{` to the last `}`,
so a valid model JSON object followed by prose containing another `{` would fail
to parse and fall back to heuristic/prose handling. It now scans for the first
parseable balanced JSON object, respecting strings and escapes, while still
preferring fenced JSON blocks. `scripts/react-smoke.ts` pins the trailing-brace
case through `parseReactDecision`.

**HARDENED — closed model-role routing is compile-time exhaustive.**
`modelForRole(role: ModelRole)` now returns `ModelRef`-typed routes and ends with
an `assertNever` branch instead of a silent DeepSeek Flash fallback. Adding a new
`ModelRole` now forces the routing table to be updated.

**HARDENED — telemetry keys are typed.** `UsageStats` is now a sparse
`UsageKey`-indexed record, and worker telemetry maps use `UsageKey` values rather
than plain strings, tightening the refactor's "typed usage keys" rule.

**HARDENED — OpenClaw control identifiers are centralized.** Gateway endpoints,
the default Gateway session key, the default OpenClaw Chat Completions model id,
and the strong-reasoning agent id now live in `OpenClawControl` in
`src/constants.ts` and are reused by `tools/{gateway,http,llm,models}.ts`.

**GUIDELINES UPDATED.** `.agent/code-guidelines.md` now records the OpenClaw
control-identifier rule, `assertNever`-style exhaustive switches for closed
unions, and balanced JSON extraction via `src/shared/json.ts`.

**Validated locally:** `npm run typecheck` passes; `smoke:react`, `smoke:patch`,
`smoke:hitl`, and `smoke:websearch` pass when run outside the restricted Codex
sandbox (the sandbox still blocks `tsx` IPC pipes with `listen EPERM`).
