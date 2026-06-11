# Boilerplate Refactor — Implementation Plan (R1–R9)

> **For agentic workers:** execute exactly ONE session (`R<n>`) per run, via
> `.agents/session-protocol.md` (trigger: `виконай сесію R<n>`). Do NOT use
> superpowers:executing-plans across sessions — the session protocol owns
> sequencing, commits, and the review chain. Steps use `- [ ]` checkboxes.

**Goal:** Refactor `ai-agents-assitant` into the profile-driven multi-LLM
boilerplate defined in
[docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md](../specs/2026-06-10-boilerplate-refactor-design.md)
(read it first — decisions D1–D12 and pinned contracts §3 are normative),
ending in a live MVP plus a basic benchmark harness.

**Architecture:** Introduce a zod-validated Profile (role→model bindings,
params, caps) threaded through LangGraph `configurable`; put all LLM traffic
behind a `ChatProvider` seam (direct SDKs default, OpenClaw legacy adapter);
add a reliability/observability kernel (retries, SqliteSaver checkpointer,
runId, per-node cost/timing, RunSummary artifact); migrate decision parsing
to native structured outputs with text fallback; add vitest unit coverage,
an offline full-graph e2e on a fake provider, and a promptfoo bench harness.

**Tech stack:** TypeScript (ESM, `.ts` imports), `@langchain/langgraph` 1.x,
`@langchain/anthropic|openai|deepseek`, `@langchain/langgraph-checkpoint-sqlite`,
zod, json5, vitest, promptfoo.

**Standing rules for every session (in addition to `.agents/*.md`):**
- Hard gate before any commit: `npm run typecheck` && `npm run lint` &&
  smoke suite green; from R1 on, also `npx vitest run`. Post-S6 the native
  hooks enforce `./verify --staged` on commit and `./verify --fast` on push
  — keep them green; never bypass with `--no-verify`.
- Out-of-scope findings → `.agents/tasks.md` § Backlog, never fixed inline.
- Never touch: `.env*`, `openclaw.config.json5*`, `.github/workflows/*`,
  and the quality-system surface (`verify`, `tools/**`, `schemas/**`,
  `.githooks/**`) except where a step explicitly says so. `quality.json`
  may be edited only where a step explicitly appends a check.
- Any session that adds a new top-level `src/` dir (R2 `src/models/`, R4
  `src/run/`) extends the layer-DAG ADR
  (`.agents/architecture-decisions.md`) and `.dependency-cruiser.cjs` in
  the same session, keeping `./verify --fast` green.
- Each task ends at its verification boundary with the pinned commit(s);
  update `.agents/handoffs/STATE.md` and `.agents/tasks.md` checkboxes.

**Quality-system alignment (prerequisite: Phase 2 sessions S6+S7 of
`self-maintaining-system` land in this repo BEFORE R1):**
- S6 vendors the pinned `./verify` runner (`quality.json`, `verify` shim,
  `tools/run-gitleaks`), installs native hooks
  (`core.hooksPath -> .githooks/`), applies the one-time prettier baseline
  (~53 files reformatted — rebase any draft diffs over it; this plan keeps
  file-level references only, so no step here pins stale line numbers), and
  executes D4: gateway-token rotation, env-only token, and REMOVAL of the
  `DEFAULT_GATEWAY_TOKEN` fallback from `src/consts/openclaw.ts` /
  `src/tools/gateway.ts`. R-sessions must not re-do or undo any of that.
- S7 approves the layer-DAG ADR, adds devDeps (`dependency-cruiser`,
  `eslint-plugin-boundaries`, `knip`), migrates `.agent/` -> `.agents/`,
  rewrites the `AGENTS.md`/`CLAUDE.md` routers, and replaces `ci.yml` with
  `quality.yml` (PR -> `./verify --fast`; push/weekly -> `./verify --full`).
  This plan is written for the POST-S7 layout: all agent-doc paths are
  `.agents/...`, and CI changes are made by appending checks to
  `quality.json` tiers (CI picks them up via `./verify --full`), never by
  editing `quality.yml` (generated, SHA-pinned, sensitive).
- Tier-budget rule for appended checks: keep `sum(timeout_seconds) <=
  budget` per tier (the manifest validator enforces it). Reference numbers
  after S7: `full` 540s of a 720s budget; `fast` 170s of 180s — so new
  checks default to the `full` tier; putting anything into `fast` requires
  raising `fast_seconds`, recorded per the D2 convention in the meta repo's
  `docs/quality-baseline.md`.

---

### R0 (owner, manual — before R1): rotate leaked credentials

The working-tree `.env` holds live Anthropic/OpenAI/DeepSeek/Tavily keys
(review §5). Rotate all four in their consoles, update `.env`, and confirm
`git ls-files | grep -c "^\.env$"` prints `0`. No session may start before
this is done. (The OpenClaw gateway token is NOT part of R0 - its rotation,
env move, and fallback removal are owned by quality-adoption session S6/D4;
R0 covers only the four provider keys.)

---

### Task R1: Test foundation — lock current behavior

**Files:**
- Create: `vitest.config.ts`, `tests/unit/pricing.test.ts`,
  `tests/unit/budget.test.ts`, `tests/unit/graph-routing.test.ts`,
  `tests/unit/swarm-routing.test.ts`, `tests/unit/parsers.test.ts`
- Modify: `package.json` (devDep `vitest`; scripts), `quality.json`
  (append `unit` check to the `full` tier)
- No `src/` behavior changes in this session.

- [x] **Step 1.1:** Add `vitest` as a devDependency (exact pin). Create
  `vitest.config.ts` (node environment, `tests/**/*.test.ts`, ESM — verify
  vitest resolves the repo's explicit-`.ts`-extension imports; if needed set
  the documented vitest/esbuild option rather than changing tsconfig).
- [x] **Step 1.2:** `tests/unit/pricing.test.ts` — characterization tests for
  `calculateUsage` (`src/tools/pricing.ts`): one case per provider family
  present in `model-pricing.json` (DeepSeek/OpenAI/Anthropic), covering
  cache-token normalization, zero-usage, and unknown-model behavior. Derive
  expected numbers by hand from the pricing JSON — these tests pin today's
  math exactly.
- [x] **Step 1.3:** `tests/unit/budget.test.ts` — `isCostBudgetNear` /
  `canSpendUsd` (`src/graph/budget.ts`): below/at/above soft ceiling,
  projected-cost edge, zero/unset budget.
- [x] **Step 1.4:** `tests/unit/graph-routing.test.ts` — every `routeAfter*`
  + `routeByComplexity` + `routeDebate` in `src/graph/routing.ts`: one test
  per branch (budget-near, escalation, retry caps, consensus, refetch). Build
  minimal `GraphState` fixtures; assert returned node names against the
  `MainNode` consts.
- [x] **Step 1.5:** `tests/unit/swarm-routing.test.ts` — `delegateToWorker`,
  `routeAfterWorker`, `routeAfterSme`, `routeAfterHuman`
  (`src/swarm/routing.ts`) incl. escalation-cap and failure-type branches.
- [x] **Step 1.6:** `tests/unit/parsers.test.ts` — `extractJsonObject`
  fallback ladder, `parseRouterDecision` heuristic fallback,
  `parseCriticDecision` regex fallback, `parseReactDecision` prose→FINAL
  convergence; valid/malformed/fenced/prose-wrapped inputs.
- [x] **Step 1.7:** Wire scripts: `"test:unit": "vitest run"`, and change
  `"test"` to `npm run typecheck && npm run lint && npm run test:unit && npm run smoke`.
  Append a `unit` check (`npm run test:unit`) to the `quality.json` `full`
  tier with a measured timeout, keeping the tier sum within budget (see the
  alignment rules above); `fast`-tier inclusion is an owner/budget decision,
  not made here. Record to `.agents/tasks.md` § Backlog as an owner
  decision: a multi-Node version matrix (22/24/latest engines) would now
  live in `quality.yml`, which is generated and SHA-pinned - propose it
  through the quality-system change process, not inline.
- [x] **Step 1.8:** Verify: `npx vitest run` → all pass; `npm test` → green.
- [x] **Step 1.9:** Commit: `test: add vitest characterization suite for pricing, budget, routing, parsers`

**Verification boundary:** `npm test` green with the new unit stage; zero
`src/` diffs (`git diff --stat -- src/` empty).

---

### Task R2: Profile foundation — bindings become data

**Files:**
- Create: `src/models/profile.ts`, `src/models/resolve.ts`,
  `src/models/index.ts`, `profiles/default.json5`,
  `tests/unit/profile.test.ts`
- Modify: `src/tools/models.ts` (switch → data lookup), `src/tools/llm.ts`
  (accept per-call options from binding), each `src/graph/nodes/*` and
  `src/swarm/*` call site that inlines thinking/effort/temperature options,
  `src/main.ts` + `src/tools/config.ts`-style DI (new configurable key),
  `src/consts/` (new env var `AGENT_PROFILE`, config key const), `package.json` (dep `json5`, `zod`)

- [x] **Step 2.1:** Define `ModelBinding` (`provider`, `model`, optional
  `transport`, `params` per spec §3.3 options subset) and `Profile` (spec
  §3.2: `name`, `description?`, `transport.default`, `roles` keyed by the
  real `ModelRole` union — exhaustive, `budget`, `tuning` all-optional with
  defaults from `src/consts/tuning.ts`, `workerTools?`, `prompts?`). zod
  schema + `loadProfile(nameOrPath)`: resolves `profiles/<name>.json5` or a
  path; fails fast on missing role, unknown provider, or `model` without a
  `model-pricing.json` entry.
- [x] **Step 2.2:** Write `profiles/default.json5` that byte-replicates
  today's bindings (`modelForRole` switch: same ModelRef strings, same
  temperatures, `transport: { default: "openclaw" }`) and today's tuning
  values. This profile keeps behavior identical until others are selected.
- [x] **Step 2.3:** Thread the active profile through LangGraph
  `configurable` exactly like `toolRegistry`/`hitlResolver` (new config key
  const + accessor with a module-default fallback to `loadProfile("default")`).
- [x] **Step 2.4:** Replace the `modelForRole` switch with
  `resolveBinding(role, profile)` (`src/models/resolve.ts`). `callLlm` keeps
  its public signature; per-role options (temperature, thinking, effort,
  maxTokens) now come from `binding.params` — delete the inlined option
  literals at the node call sites (`architects.ts`, `critics.ts`,
  `tiebreaker.ts`, `coder.ts`, `direct.ts`, `router.ts`, swarm nodes,
  `react-worker.ts`), preserving today's effective values inside
  `default.json5`.
- [x] **Step 2.5:** Replace hardcoded tuning-const reads on the
  routing/budget paths (`MAX_*`, escalation threshold, projected costs) with
  profile-resolved values defaulting to the existing consts; the consts stay
  as the single source of default values.
- [x] **Step 2.6:** `tests/unit/profile.test.ts` — loader happy path,
  missing-role failure, unknown-provider failure, missing-pricing failure,
  tuning default merge; plus a regression test asserting
  `resolveBinding(role, defaultProfile)` reproduces the pre-refactor
  switch's bindings for all roles.
- [x] **Step 2.7:** Verify: `npm test` green (R1 suites must pass
  unchanged — they pin behavior).
- [x] **Step 2.8:** Commit: `feat: introduce zod-validated model profiles; role bindings become data`

**Verification boundary:** `npm test` green; `npm start -- "2+2?"` (cheap
trivial route, budget default) behaves as before with `default.json5`.

---

### Task R3: Provider seam — direct transport + retries

**Files:**
- Create: `src/models/provider.ts`, `src/models/providers/direct.ts`,
  `src/models/providers/openclaw.ts`, `src/models/retry.ts`,
  `tests/unit/retry.test.ts`, `tests/unit/providers.test.ts`
- Modify: `src/tools/llm.ts` (becomes shim: resolve binding → provider),
  `src/consts/pricing/model-pricing.json` (add `claude-fable-5` $10/$50,
  `claude-haiku-4-5` $1/$5, plus current direct API ids used by the example
  profiles; Anthropic cache write ×1.25 / read ×0.1 of input), `package.json`
  (add `@langchain/deepseek`; `@langchain/anthropic`/`@langchain/openai`
  become load-bearing)

- [x] **Step 3.1:** Pin the `ChatProvider`/`ChatCallOptions`/`ChatResult`
  interfaces exactly as spec §3.3, aligning the message shape with the
  current `callLlm` internals (system + user strings) so call sites stay
  untouched.
- [x] **Step 3.2:** `providers/openclaw.ts`: extract the existing request
  construction from `src/tools/llm.ts` verbatim (body model, headers,
  `strong-reasoning` agent special-case, JSON response_format), preserving
  behavior for `transport: "openclaw"` bindings.
- [x] **Step 3.3:** `providers/direct.ts`: LangChain `initChatModel` per
  provider prefix (`anthropic:`/`openai:`/`deepseek:`); map
  `ChatCallOptions` honoring current Anthropic API semantics — adaptive
  thinking via `thinking: {type:"adaptive"}`, effort via
  `output_config.effort`, NO temperature/top_p on Fable 5/Opus 4.8/4.7,
  omit `thinking` entirely instead of disabling on Fable 5; system-prompt
  `cache_control` breakpoint when `cacheSystemPrompt` is set. Normalize each
  provider's usage fields into the existing `LlmUsage` shape (extend the R1
  pricing fixtures with one direct-shape case per provider).
- [x] **Step 3.4:** `retry.ts`: exponential backoff + full jitter, default 2
  retries (profile `tuning.llmMaxRetries`), retry-on: HTTP 429/5xx/timeouts/
  network errors; never retry 4xx validation errors. Providers call through
  it. Unit-test with a stubbed failing function (no network).
- [x] **Step 3.5:** Wire `callLlm` shim: resolve binding → pick provider by
  `binding.transport ?? profile.transport.default` → `provider.call(...)` →
  existing cost/usage accounting against `ChatResult.pricingKey` (unchanged
  math — R1 tests must stay green).
- [x] **Step 3.6:** `tests/unit/providers.test.ts` — option-mapping table
  tests for `direct.ts` (built request params per binding/params combo,
  using the model classes' invocation params without network) + an
  openclaw-adapter request-shape test mirroring the pre-refactor body.
- [x] **Step 3.7:** Verify: `npm test` green. Manual spot check (requires
  rotated keys): `BUDGET=0.03 scripts/run-task.sh "What is 2+2?"` with a
  temporary profile whose `direct` role binds `claude-haiku-4-5` — confirm a
  live direct-transport answer + cost line.
- [x] **Step 3.8:** Commit: `feat: ChatProvider seam — direct LangChain transport, openclaw adapter, retry layer`

**Verification boundary:** `npm test` green; live haiku spot-check answered
through the direct provider with non-zero cost accounting.

---

### Task R4: Reliability + run observability kernel

**Files:**
- Create: `src/run/run-context.ts`, `src/run/node-lifecycle.ts`,
  `src/run/run-summary.ts`, `src/run/index.ts`, `tests/unit/run.test.ts`
- Modify: `src/graph/build.ts` (wrap nodes; attach checkpointer),
  `src/main.ts` + `src/cli/*` (`--resume <runId>`, failure-path report,
  summary write), `.gitignore` (`reports/`), `package.json`
  (`@langchain/langgraph-checkpoint-sqlite`)

- [x] **Step 4.1:** `run-context.ts`: `runId` (crypto.randomUUID), profile
  name, start time; threaded via `configurable` beside the profile;
  `thread_id = runId`.
- [x] **Step 4.2:** `node-lifecycle.ts`: `wrapNode(name, fn)` — debug log on
  enter; on exit log `{ node, runId, durationMs, costDeltaUsd, model? }`
  via `getLogger().child({module:"graph"})`, computing cost delta from
  `usageStats` before/after. Apply to every main-graph node registration in
  `build.ts` (swarm nodes optional — only if trivially identical).
  (Done: cost delta read from the reducer-delta update; the optional `model`
  field was dropped — UsageKey does not map 1:1 to ModelRole; swarm nodes
  not wrapped — run context is not threaded into the isolated swarm config.)
- [x] **Step 4.3:** Attach `SqliteSaver` (file under `.agent-runs.sqlite` or
  `reports/checkpoints.sqlite` — gitignored) to the main graph compile;
  `--resume <runId>` re-invokes with the same `thread_id` and no new task
  input; document the flag in `--help` output and README section.
  (Done: `reports/checkpoints.sqlite`; README created; `--resume` validates
  a lowercase-UUID runId and fails fast on an unknown checkpoint — R4 review.)
- [x] **Step 4.4:** `run-summary.ts`: build `RunSummary` exactly as spec
  §3.4 from final state + node-lifecycle records; write
  `reports/runs/<runId>.json` on success, budget-stop, AND the catch path in
  `main.ts` (status `failed`, partial usage included). Console report
  (`cli/report.ts`) now also prints `runId` + summary path on all paths.
  (`budget_stopped` = final-state `isCostBudgetNear` heuristic; SIGINT path
  also writes the failed summary.)
- [x] **Step 4.5:** `tests/unit/run.test.ts` — wrapNode timing/cost-delta
  accounting with a stub node; RunSummary writer on the three status paths
  (temp dir). (15 cases incl. runId-validation guards from the R4 review.)
- [x] **Step 4.6:** Verify: `npm test` green; kill a live run mid-flight
  (Ctrl-C after first node) → `reports/runs/<id>.json` exists with
  `status:"failed"` and partial cost. (Done live: SIGINT after
  complexityRouter → failed summary with $0.001434 partial cost; bonus:
  `--resume` of that run re-entered the thread at `swarm` and completed.)
- [x] **Step 4.7:** Commit: `feat: run kernel — runId, sqlite checkpointer, per-node cost/timing, RunSummary artifact`

**Verification boundary:** `npm test` green; failure-path summary verified.

---

### Task R5: Structured outputs (main graph) + prompt de-cascading

**Files:**
- Create: `src/types/graph/decisions.ts` (zod schemas), `tests/unit/structured.test.ts`
- Modify: `src/graph/parsers.ts` (accept pre-parsed objects),
  `src/graph/nodes/{router,architects,critics,coder,tiebreaker}.ts`,
  `src/swarm/nodes.ts` (leadDelegator), `src/prompts/core.ts` +
  `src/prompts/reasoning-prompts.ts` (cascade prose → profile-injected note),
  `src/models/providers/direct.ts` (withStructuredOutput path)

- [x] **Step 5.1:** Write zod schemas mirroring the JSON shapes the existing
  parsers expect (router decision, architect decision incl. confidence,
  critic decision, tiebreaker, worker-kind selection). Source of truth = the
  current parser expectations + prompt contracts; do not change field names
  (prompt copy and parsers stay aligned — `.agents/code-guidelines.md` §6).
- [x] **Step 5.2:** Direct provider: when `structuredSchema` is set, use the
  model's `withStructuredOutput(schema)` (native json_schema where
  supported; DeepSeek strict may need its beta endpoint — feature-flag per
  provider and fall back to JSON mode + text parsing when unsupported).
  OpenClaw transport ignores `structuredSchema` (text path).
- [x] **Step 5.3:** Node call sites pass the schema; each parse site first
  uses `ChatResult.parsed` when present, else the existing text parser —
  the fallback ladder is preserved verbatim (R1 parser tests unchanged).
- [x] **Step 5.4:** Replace hardcoded model-cascade prose in prompts with
  the profile's `prompts.cascadeNote` (byte-stable per profile — prompt
  cache anchors remain deterministic for a given profile). Verify no parser
  contract text changed.
- [x] **Step 5.5:** `tests/unit/structured.test.ts` — schemas accept the
  fixtures used by R1 parser tests; parse-site precedence (parsed > text
  fallback) with stubbed `ChatResult`s.
- [x] **Step 5.6:** Verify: `npm test` green; live spot check on a
  pure-reasoning task with a direct-transport profile.
- [x] **Step 5.7:** Commit: `feat: native structured outputs with text fallback; profile-injected cascade prompts`

**Verification boundary:** `npm test` green; reasoning route live check OK.
Swarm ReAct-step structured migration is OUT of scope (backlog).

---

### Task R6: Profiles + CLI surface + example profiles

**Files:**
- Create: `profiles/personal-dev.json5`, `profiles/research-playground.json5`,
  `profiles/client-baseline.json5`
- Modify: `src/cli/config.ts` + `src/main.ts` (`--profile` flag +
  `AGENT_PROFILE` env), `scripts/run-task.sh` (PROFILE passthrough),
  `.env.example`, `README.md` (or create — usage, profiles, resume, bench
  pointer), `.agents/memory.md` (§ Architecture: profiles/providers note)

- [ ] **Step 6.1:** `--profile <name|path>` flag (default `default`),
  `AGENT_PROFILE` env override; profile name flows into RunSummary (already
  in the type) and the console report header.
- [ ] **Step 6.2:** Author the three example profiles per spec §3.2
  (personal-dev pinned there; research-playground = current DeepSeek cascade
  on direct transport; client-baseline = cheap cascade, Sonnet coder, Opus
  SME, budget 0.50). Every `model` must have a pricing entry — extend
  `model-pricing.json` if a chosen id is missing.
- [ ] **Step 6.3:** `run-task.sh`: add `PROFILE` env passthrough
  (`PROFILE=personal-dev BUDGET=0.25 scripts/run-task.sh "<task>"`).
- [ ] **Step 6.4:** Update `.env.example` (AGENT_PROFILE, note that provider
  keys are now read directly by the app for direct transport) and write the
  README sections (quickstart, profile anatomy, resume, transports).
- [ ] **Step 6.5:** Loader test additions: all four shipped profiles load
  and validate in CI (`tests/unit/profile.test.ts` — parametrized).
- [ ] **Step 6.6:** Verify: `npm test` green; `npm start -- --profile
  research-playground "Summarize: <one paragraph>"` runs live cheap.
- [ ] **Step 6.7:** Commit: `feat: profile CLI surface + personal-dev / research-playground / client-baseline profiles`

**Verification boundary:** `npm test` green; all profiles validate; live
cheap run per at least one non-default profile.

---

### Task R7: Benchmark harness (promptfoo + programmatic entrypoint)

**Files:**
- Create: `src/run/run-agent-task.ts` (programmatic entrypoint),
  `bench/promptfooconfig.yaml`, `bench/agent-provider.mjs` (or `.ts` per
  promptfoo's custom-provider docs), `bench/suites/smoke.yaml` (if separate
  from main config), `bench/fixtures/mini-ts-repo/` (tiny TS package with a
  deliberate bug task), `bench/README.md`
- Modify: `src/index.ts` (export `runAgentTask`), `package.json`
  (devDep `promptfoo`; script `"bench"`), `.gitignore` (`reports/bench/`)

- [ ] **Step 7.1:** `runAgentTask(task, { profile, budgetUsd, applyPatches,
  hitl:"off", workspaceDir? }) → Promise<RunSummary>` — refactor `main.ts`
  to be a thin CLI over this function (no behavior change; smoke scripts
  keep importing the barrel).
- [ ] **Step 7.2:** Consult current promptfoo docs for the custom JS
  provider API; implement `bench/agent-provider.mjs` calling `runAgentTask`
  (profile from test vars), returning output + `tokenUsage`/cost metadata
  from RunSummary.
- [ ] **Step 7.3:** Smoke suite, 6 tasks: 2 trivial (assert `contains`),
  2 pure-reasoning (assert `llm-rubric` with a cheap judge model +
  `cost`/`latency` thresholds), 2 coding tasks against a copy of
  `bench/fixtures/mini-ts-repo` (javascript assert: patch applied and
  `npx tsc --noEmit` exits 0 in the fixture copy; fixture reset per run).
- [ ] **Step 7.4:** `npm run bench` → `promptfoo eval` with config; results
  + a short generated markdown table land in `reports/bench/<timestamp>/`.
  Add an offline mode flag that runs the same suite against the fake
  provider (R8 dependency note: until R8 lands, offline mode may be a
  no-op guard — leave a backlog checkbox if so).
- [ ] **Step 7.5:** Verify: `npm test` green; `PROFILE=research-playground
  npm run bench -- --filter trivial` (or promptfoo's equivalent filter)
  completes live under $0.10 total.
- [ ] **Step 7.6:** Commit: `feat: promptfoo bench harness + runAgentTask entrypoint + smoke suite`

**Verification boundary:** `npm test` green; filtered live bench run
produces a report with cost/latency per task.

---

### Task R8: Offline e2e + security hardening + dependency pinning

**Files:**
- Create: `src/models/providers/fake.ts`, `tests/e2e/offline-run.test.ts`,
  `tests/e2e/scripts/` fixtures as needed
- Modify: `src/consts/patching.ts` (PROTECTED_SEGMENTS widening),
  `package.json` (exact-pin `openclaw`, `@langchain/*`, `typescript`;
  declare ripgrep requirement in README + preflight warn), `quality.json`
  (append `e2e` check to the `full` tier)
- Verify only (S6/D4 already changed them): `src/consts/openclaw.ts`,
  `src/tools/gateway.ts` — the `DEFAULT_GATEWAY_TOKEN` fallback is gone

- [ ] **Step 8.1:** `fake.ts`: deterministic scripted `ChatProvider` —
  responses keyed by role (+ ordinal per role), loaded from a per-test
  script object; emits synthetic usage so cost accounting runs. No I/O.
- [ ] **Step 8.2:** `tests/e2e/offline-run.test.ts`: three full
  `runAgentTask` runs on a `fake`-transport profile: (a) trivial route,
  (b) pure-reasoning route incl. one escalation, (c) tool/code route with
  patches enabled in a temp workspace — scripted coder output patches a
  fixture file, verify node runs `npx tsc --noEmit`, then force one failed
  verification to assert finalize rollback restores the file. Assert
  RunSummary fields (status, nodeVisits order, cost > 0).
- [ ] **Step 8.3:** Widen `PROTECTED_SEGMENTS` per spec D10; extend the R1-era
  patch tests (or `patch-smoke.ts`) to assert `.github/`, `.env`,
  `package.json`, `openclaw.config.json5` are refused — and the
  quality-system surface too: `verify`, `tools/`, `schemas/`, `.githooks/`,
  `quality.json` (the agent's patch engine must never edit its own gates).
- [ ] **Step 8.4:** Verify the S6/D4 hardening still holds (do not re-do
  it): `DEFAULT_GATEWAY_TOKEN` absent from the codebase, openclaw transport
  without `OPENCLAW_GATEWAY_TOKEN` fails fast (direct transport
  unaffected), `.env.example` documents the variable. If the S6 failure
  message is unclear, improve the message only; never reintroduce a
  default.
- [ ] **Step 8.5:** Exact-pin `openclaw`, `@langchain/langgraph`,
  `@langchain/anthropic|openai|deepseek`, `typescript`, checkpoint-sqlite;
  `npm ci` clean; add a preflight `rg --version` check with a warning (not a
  crash) at swarm startup.
- [ ] **Step 8.6:** Verify: `npm test` green INCLUDING the offline e2e —
  this is the first time the full dual-graph path is exercised without
  credentials. Wire `tests/e2e` into the `quality.json` `full` tier (an
  `e2e` check with a measured timeout, tier sum within budget) — CI's
  `./verify --full` picks it up with no workflow edit.
- [ ] **Step 8.7:** Commit (two allowed):
  `feat: fake provider + offline full-graph e2e` and
  `chore(security): widen patch guards, require gateway token, pin deps`

**Verification boundary:** offline e2e green in CI without any secrets.

---

### Task R9: Live MVP validation + baseline tag

**Files:**
- Modify: `.agents/memory.md` (§2 architecture: profiles/providers/run
  kernel; §6 status), `.agents/tasks.md` (close R-schedule, promote backlog),
  `docs/reviews/2026-06-10-project-review.md` (append "post-refactor status"
  footnote), `README.md` (measured-cost table),
  `quality-baselines/knip.json` (refresh — see Step 9.5)
- No new subsystems.

- [ ] **Step 9.1:** Live matrix (rotated keys, small budgets): for each of
  the three example profiles run (a) one trivial, (b) one reasoning, (c) one
  small real coding task on this repo with `APPLY=1` in a scratch git
  worktree (`BUDGET=0.50`). Record runId, cost, duration, verification
  result from RunSummary files.
- [ ] **Step 9.2:** Fix what the live matrix breaks — scoped strictly to
  making the MVP pass (anything bigger → backlog with a written note).
- [ ] **Step 9.3:** `npm run bench` full smoke suite live on
  `research-playground`; commit the generated summary table into
  `bench/README.md` as the first baseline.
- [ ] **Step 9.4:** Update `.agents/memory.md` (architecture + status dated
  entry), close `.agents/tasks.md` R-items, append measured-cost table to
  README.
- [ ] **Step 9.5:** Refresh the dead-code baseline against the refactored
  tree: re-run knip, commit the new finding set as
  `quality-baselines/knip.json` (R3 made `@langchain/anthropic|openai`
  load-bearing and R1-R8 moved/added modules, so the S7 baseline is stale).
  Then verify: `npm test` green; `./verify --full` green within budgets;
  all 9 live runs completed or explained; baseline bench report committed.
- [ ] **Step 9.6:** Commit: `docs: live MVP validation results + baseline bench` then tag:
  `git tag v0.1.0-boilerplate`.

**Verification boundary:** MVP exit criterion from spec §1 fully met.

---

## Self-review notes (author)

- Spec coverage: D1→R3, D2/D3→R2/R6, D4/D5/D9→R4, D6→R5, D7→R7, D8→R1,
  D10→R0/R8, D11/D12→`.agents/` protocol files (created alongside this
  plan). All spec §3 contracts have an owning task.
- Known sequencing constraints: R5 needs R3 (structured outputs ride the
  direct provider); R7 needs R4+R6; R8's offline-bench hookup may leave one
  checkbox to backlog if promptfoo offline mode lands before fake provider
  (noted in R7.4). Linear execution R1→R9 is the supported order.
- Deliberately NOT specified at code level: exact `ModelRole` key names,
  `callLlm` internal signature, promptfoo provider API details — the
  executing session derives them from the live code/docs; the invariants
  that matter are pinned in spec §3.
- 2026-06-10 alignment edit (owner-requested): R-sessions now explicitly
  start AFTER quality-adoption sessions S6+S7 land here. Changes: standing
  rules reference the post-S7 `.agents/` layout and the `./verify` hooks;
  a Quality-system alignment section pins the S6/S7 deliverables and the
  tier-budget rule; R0 scoped to the four provider keys (gateway token =
  S6/D4); R1.7/R8.6 wire unit/e2e into `quality.json` `full` instead of the
  deleted `ci.yml` (Node-matrix idea moved to backlog); R8 verifies rather
  than re-does the S6/D4 fallback removal; R8.3 adds the quality-system
  surface to the patch-refusal list; R9.5 refreshes the knip baseline and
  gates on `./verify --full`.
