# Project Knowledge Base - `ai-agents-assitant`

> Persistent context for AI assistants. This is the current source of truth, not
> a full changelog. Keep it compact and update it when architecture, unresolved
> context, or working contracts change.

Read with [.agent/guidelines.md](guidelines.md), [.agent/code-guidelines.md](code-guidelines.md),
and [.agent/tasks.md](tasks.md).

## 1. Project Goal

Autonomous development and cognitive-reasoning framework in TypeScript using
`@langchain/langgraph`. It separates orchestration, tool execution, context
compression, debate/review, guarded patch application, and objective
verification. Cost is a first-class design constraint: cheap models route,
compress, and plan worker steps; frontier models do the first architecture/review
pass; the strongest models run only behind escalation gates.

---

## 2. Current Architecture

The system uses a dual-graph design.

### Main Graph: reasoning and orchestration

Entry point: `src/main.ts` starts/probes OpenClaw Gateway, builds
`buildMainGraph()`, passes `costBudgetUsd`, `patchApplicationEnabled`, and the
HITL resolver, then prints final answer, patch report, and telemetry.

Topology in `src/graph/build.ts`:
- `complexityRouter` routes tasks to:
  - `directResponder -> finalize` for trivial work.
  - `frontierArchitect -> optional claudeArchitect -> finalize` for `pure_reasoning`.
  - `swarm -> firewall -> frontierArchitect -> optional claudeArchitect -> claudeCoder -> frontierCritic -> optional openaiCritic/debate/refetch/tiebreaker -> applyPatches -> verify -> finalize` for tool/code work.
- `routeAfterCoder` sends normal drafts to `frontierCritic`; patch-format retries
  marked by `awaitingPatchReformat` go straight back to `applyPatches`.
- `applyPatches -> verify` only when patch application succeeded or is disabled;
  failed patch formatting/guarded skips route back to `claudeCoder` until the
  patch-format retry cap, then finalize.

Model cascade in `src/tools/models.ts`:
- `router`, `directResponder`, `firewall`, and worker planners use
  DeepSeek V4 Flash through `ModelRole.ROUTER`/`FIREWALL`/`WORKER`.
- `frontierArchitect`, `frontierCritic`, and swarm `smeOracle` use
  DeepSeek V4 Pro through `ModelRole.FRONTIER`.
- Strong escalation uses Claude Opus for `claudeArchitect`/`smeTiebreaker`,
  Claude Sonnet for `claudeCoder`, and GPT for `openaiCritic`.
- Claude Opus adaptive thinking routes through the `strong-reasoning` OpenClaw
  agent; Anthropic payloads omit temperature when adaptive thinking is enabled.

Routing guards in `src/graph/routing.ts` and `src/graph/budget.ts`:
- Soft USD budget: `GraphState.costBudgetUsd`, default `$1.00`
  (`AGENT_COST_BUDGET_USD` override). Routers stop expensive next steps when
  `totalCost + projectedCost` nears the soft ceiling.
- Hard caps remain separate: `MAX_CONTEXT_FETCHES = 2`,
  `MAX_VERIFY_ATTEMPTS = 2`, `MAX_DEBATE_ITERATIONS = 4`,
  `MAX_PATCH_FORMAT_RETRIES = 2`.
- Debate refetches are targeted by `buildSwarmSubtask()` from the debate summary
  and latest critique terms, not broad repo inventory.

### Swarm Sub-Graph: execution layer

`buildSwarm()` compiles a fresh sub-graph with a fresh `MemorySaver` checkpointer
for every main-graph swarm invocation, isolating HITL checkpoints between the
initial context fetch and targeted refetches.

Flow:
- `leadDelegator` classifies the subtask into a `WorkerKind`, seeded by
  `selectWorkerKind()` and falling back to the heuristic if the model call fails.
- Workers (`codeExplorer`, `infraOps`, `webResearcher`) are bounded ReAct agents:
  the worker model chooses one tool per step, reads the observation, and either
  acts again or returns final output.
- `workerCompress` turns raw output into the compressed summary consumed by
  `firewall`; raw observations are stored as artifacts and referenced by index.

Worker safety envelope: `MAX_REACT_STEPS = 6`, `MAX_REACT_TOOL_FAILURES = 3`;
per-worker tool catalogs in `src/swarm/tool-catalog.ts`; `sanitizeToolArgs()`
validates args and pre-checks shell commands. Local OpenClaw adapters remain the
authoritative guard for workspace path bounds, exact command allowlist, no shell
interpolation, timeouts, and artifact storage. Non-zero shell exits are evidence,
not worker failure. Reasoning failures go to `smeOracle`; environment failures
go to `humanGate`.

### HITL behavior

Swarm `humanGate` always calls LangGraph `interrupt()` with a structured
`HitlInterruptPayload`; availability is decided by the resolver:
- Interactive TTY runs use `createStdinHitlResolver()` by default.
- Falsey `AGENT_HITL` or non-TTY runs use `autoAbortResolver()`.
- `driveSwarmWithHitl()` resumes with `Command({ resume })`; retry guidance feeds
  the worker, while abort returns a `BLOCKED` summary through the firewall.

Main-graph HITL is not wired yet; only swarm environment-failure escalation has
real interrupt/resume behavior.

---

## 3. Patch Application and Verification

Patch application is opt-in through `AGENT_APPLY_PATCHES`; when disabled,
`applyPatches` is a no-op before `verify`.

When enabled:
- `claudeCoder` must emit full-file blocks:
  `<<<PATCH file="relative/path">>> ... <<<END PATCH>>>`.
- `parsePatchBlocks()` ignores prose outside blocks; later blocks for the same
  file win.
- `applyPatchBlocks()` resolves paths through `resolveWorkspacePath()`, refuses
  workspace escapes, `.git`, and `node_modules`, snapshots pristine files, tracks
  newly created files, and writes only after guards pass.
- If there are no structured blocks, or every block is skipped, verification is
  skipped and the graph asks the coder to reformat until the retry cap.
- `verify` runs `openclawRpc("run_tests", { command: "npm run typecheck" })`
  for code paths; `pure_reasoning` skips typecheck and finalizes the reasoning
  output.
- `finalize` keeps applied files only when verification passed. If verification
  failed after patches were applied, it restores backed-up files and deletes
  created files.

---

## 4. OpenClaw and Tooling

Public import surface is intentionally stable through the side-effect-free root
barrel `src/index.ts`. The CLI lives in `src/main.ts`; importing `src/index.ts`
must not start the agent.
Subsystem roots with multiple TypeScript modules also expose named-export
`index.ts` barrels (for example `src/graph/`, `src/swarm/`, `src/tools/`,
`src/consts/`, `src/shared/`, and `src/types/*`). Barrel consumers import the
owning folder, not `/index.ts`; concrete local file imports keep explicit `.ts`
extensions. Internal subsystem modules still import concrete files to preserve
cycle safety.

OpenClaw details:
- Chat calls use `/v1/chat/completions` with `x-openclaw-model`; default body
  model is `openclaw/default` unless using the `strong-reasoning` agent.
- Local pseudo-tools deterministically handle `run_tests`, `shell_exec`,
  `ast_read`, `find_files`, and `grep_code`.
- `SAFE_DIRECT_EXEC_COMMANDS` is the only shell allowlist:
  `git status --short`, `npm run build`, `npm run test`, `npm run typecheck`,
  `npm test`, `npx tsc --noEmit`.
- `web_lookup` is wrapper-driven failover: Tavily rich search first, DuckDuckGo
  fallback on any Tavily error, timeout, or empty result. DuckDuckGo is key-free
  but experimental; empty fallback results should become warnings when structured
  logging exists.

Telemetry: `callLlm` calculates cost from
`src/consts/pricing/model-pricing.json`, including provider cache fields when
present, and `UsageStats` is a sparse `UsageKey`-indexed record with totals in
`totalCost` and `totalTokens`.

---

## 5. Code Organization Rules That Matter

Follow [.agent/code-guidelines.md](code-guidelines.md). High-signal reminders:
- Define runtime scalars once in `src/consts/*`; pair each closed `as const`
  object with its same-named union type in the same consts module. There is no
  separate `src/types/consts/*` layer.
- Constant audit on 2026-06-06 centralized runtime caps, timeouts, route maps,
  allowlists, patch guards, HITL config keys, and web fallback knobs under
  `src/consts/*`. Prompt cache anchors remain in `src/prompts/` by design.
- Keep `ModelRef` values byte-equal to
  `src/consts/pricing/model-pricing.json` keys.
- Shared/public types live under `src/types/*`; implementation modules may
  re-export those types only to preserve public barrels.
- Use shared helpers in `src/shared/*` for JSON extraction, text coercion, error
  formatting, usage merging, and telemetry shape.
- Internal modules import concrete files, not subsystem barrels they re-export.
- Use explicit `.ts` extensions for concrete local TypeScript file imports.
  Import `index.ts` barrels from the owning folder; TypeScript uses `bundler`
  resolution so folder-barrel specifiers typecheck, while
  `rewriteRelativeImportExtensions` rewrites concrete `.ts` imports on emit.
- `src/` root is reserved for `main.ts` as the executable entrypoint and
  `index.ts` as the single public export barrel. Feature modules, domain types,
  adapters, constants, and runtime data should live under their owning folders.
  Patch implementation lives in `src/patching/`; HITL resolvers and
  swarm-driving helpers live in `src/hitl/`.
- Prompts are cache anchors. Keep `SystemPrompts` output contracts aligned with
  parsers in `src/graph/parsers.ts` and `src/swarm/tool-validation.ts`.
- Comments should explain non-obvious safety/cost/provider/order invariants.
  Use block comments in code; avoid decorative or self-evident comments.

---

## 6. Current Status and Backlog

Current status as of 2026-06-06:
- MVP is executable through `npm start -- "<task>"`.
- `npm run typecheck` passes. Smoke scripts pass outside this restricted Codex
  sandbox; the sandbox can block `tsx` IPC pipes with `listen EPERM`.
- `npm test` aliases `npm run typecheck`; there is no separate unit suite yet.
- Full live end-to-end execution still needs valid provider credentials and a
  reachable OpenClaw Gateway/runtime.

Open backlog:
- Wire main-graph HITL approval/interrupt flows; current HITL is swarm-only.
- Add structured logging, including warnings for empty DuckDuckGo fallback
  results.

---

## 7. Memory Audit Note - 2026-06-06

This file was consolidated from a chronological audit log into current
architecture, invariants, and backlog. Removed stale details that conflicted
with code, especially older `humanGate` blocking notes and patch notes that
omitted patch-format retries. Checked `src/graph/*`, `src/state/*`,
`src/swarm/*`, `src/tools/*`, `src/patching/*`, `src/hitl/*`, `src/index.ts`,
`src/main.ts`, and `package.json`. Companion cleanup reduced `.agent/tasks.md`
to active tasks and backlog only.
