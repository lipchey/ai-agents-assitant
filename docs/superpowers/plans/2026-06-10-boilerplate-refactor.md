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

**Standing rules for every session (in addition to `.agent/*.md`):**
- Hard gate before any commit: `npm run typecheck` && `npm run lint` &&
  smoke suite green; from R1 on, also `npx vitest run`.
- Out-of-scope findings → `.agent/tasks.md` § Backlog, never fixed inline.
- Never touch: `.env*`, `openclaw.config.json5*`, `.github/workflows/*`
  except where a step explicitly says so.
- Each task ends at its verification boundary with the pinned commit(s);
  update `.agents/handoffs/STATE.md` and `.agent/tasks.md` checkboxes.

---

### R0 (owner, manual — before R1): rotate leaked credentials

The working-tree `.env` holds live Anthropic/OpenAI/DeepSeek/Tavily keys
(review §5). Rotate all four in their consoles, update `.env`, and confirm
`git ls-files | grep -c "^\.env$"` prints `0`. No session may start before
this is done.

---

### Task R1: Test foundation — lock current behavior

**Files:**
- Create: `vitest.config.ts`, `tests/unit/pricing.test.ts`,
  `tests/unit/budget.test.ts`, `tests/unit/graph-routing.test.ts`,
  `tests/unit/swarm-routing.test.ts`, `tests/unit/parsers.test.ts`
- Modify: `package.json` (devDep `vitest`; scripts), `.github/workflows/ci.yml`
- No `src/` behavior changes in this session.

- [ ] **Step 1.1:** Add `vitest` as a devDependency (exact pin). Create
  `vitest.config.ts` (node environment, `tests/**/*.test.ts`, ESM — verify
  vitest resolves the repo's explicit-`.ts`-extension imports; if needed set
  the documented vitest/esbuild option rather than changing tsconfig).
- [ ] **Step 1.2:** `tests/unit/pricing.test.ts` — characterization tests for
  `calculateUsage` (`src/tools/pricing.ts`): one case per provider family
  present in `model-pricing.json` (DeepSeek/OpenAI/Anthropic), covering
  cache-token normalization, zero-usage, and unknown-model behavior. Derive
  expected numbers by hand from the pricing JSON — these tests pin today's
  math exactly.
- [ ] **Step 1.3:** `tests/unit/budget.test.ts` — `isCostBudgetNear` /
  `canSpendUsd` (`src/graph/budget.ts`): below/at/above soft ceiling,
  projected-cost edge, zero/unset budget.
- [ ] **Step 1.4:** `tests/unit/graph-routing.test.ts` — every `routeAfter*`
  + `routeByComplexity` + `routeDebate` in `src/graph/routing.ts`: one test
  per branch (budget-near, escalation, retry caps, consensus, refetch). Build
  minimal `GraphState` fixtures; assert returned node names against the
  `MainNode` consts.
- [ ] **Step 1.5:** `tests/unit/swarm-routing.test.ts` — `delegateToWorker`,
  `routeAfterWorker`, `routeAfterSme`, `routeAfterHuman`
  (`src/swarm/routing.ts`) incl. escalation-cap and failure-type branches.
- [ ] **Step 1.6:** `tests/unit/parsers.test.ts` — `extractJsonObject`
  fallback ladder, `parseRouterDecision` heuristic fallback,
  `parseCriticDecision` regex fallback, `parseReactDecision` prose→FINAL
  convergence; valid/malformed/fenced/prose-wrapped inputs.
- [ ] **Step 1.7:** Wire scripts: `"test:unit": "vitest run"`, and change
  `"test"` to `npm run typecheck && npm run lint && npm run test:unit && npm run smoke`.
  Add a Node version matrix to `ci.yml` covering the three `engines` ranges
  (22 / 24 / latest), keeping the single job otherwise.
- [ ] **Step 1.8:** Verify: `npx vitest run` → all pass; `npm test` → green.
- [ ] **Step 1.9:** Commit: `test: add vitest characterization suite for pricing, budget, routing, parsers`

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

- [ ] **Step 2.1:** Define `ModelBinding` (`provider`, `model`, optional
  `transport`, `params` per spec §3.3 options subset) and `Profile` (spec
  §3.2: `name`, `description?`, `transport.default`, `roles` keyed by the
  real `ModelRole` union — exhaustive, `budget`, `tuning` all-optional with
  defaults from `src/consts/tuning.ts`, `workerTools?`, `prompts?`). zod
  schema + `loadProfile(nameOrPath)`: resolves `profiles/<name>.json5` or a
  path; fails fast on missing role, unknown provider, or `model` without a
  `model-pricing.json` entry.
- [ ] **Step 2.2:** Write `profiles/default.json5` that byte-replicates
  today's bindings (`modelForRole` switch: same ModelRef strings, same
  temperatures, `transport: { default: "openclaw" }`) and today's tuning
  values. This profile keeps behavior identical until others are selected.
- [ ] **Step 2.3:** Thread the active profile through LangGraph
  `configurable` exactly like `toolRegistry`/`hitlResolver` (new config key
  const + accessor with a module-default fallback to `loadProfile("default")`).
- [ ] **Step 2.4:** Replace the `modelForRole` switch with
  `resolveBinding(role, profile)` (`src/models/resolve.ts`). `callLlm` keeps
  its public signature; per-role options (temperature, thinking, effort,
  maxTokens) now come from `binding.params` — delete the inlined option
  literals at the node call sites (`architects.ts`, `critics.ts`,
  `tiebreaker.ts`, `coder.ts`, `direct.ts`, `router.ts`, swarm nodes,
  `react-worker.ts`), preserving today's effective values inside
  `default.json5`.
- [ ] **Step 2.5:** Replace hardcoded tuning-const reads on the
  routing/budget paths (`MAX_*`, escalation threshold, projected costs) with
  profile-resolved values defaulting to the existing consts; the consts stay
  as the single source of default values.
- [ ] **Step 2.6:** `tests/unit/profile.test.ts` — loader happy path,
  missing-role failure, unknown-provider failure, missing-pricing failure,
  tuning default merge; plus a regression test asserting
  `resolveBinding(role, defaultProfile)` reproduces the pre-refactor
  switch's bindings for all roles.
- [ ] **Step 2.7:** Verify: `npm test` green (R1 suites must pass
  unchanged — they pin behavior).
- [ ] **Step 2.8:** Commit: `feat: introduce zod-validated model profiles; role bindings become data`

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

- [ ] **Step 3.1:** Pin the `ChatProvider`/`ChatCallOptions`/`ChatResult`
  interfaces exactly as spec §3.3, aligning the message shape with the
  current `callLlm` internals (system + user strings) so call sites stay
  untouched.
- [ ] **Step 3.2:** `providers/openclaw.ts`: extract the existing request
  construction from `src/tools/llm.ts` verbatim (body model, headers,
  `strong-reasoning` agent special-case, JSON response_format), preserving
  behavior for `transport: "openclaw"` bindings.
- [ ] **Step 3.3:** `providers/direct.ts`: LangChain `initChatModel` per
  provider prefix (`anthropic:`/`openai:`/`deepseek:`); map
  `ChatCallOptions` honoring current Anthropic API semantics — adaptive
  thinking via `thinking: {type:"adaptive"}`, effort via
  `output_config.effort`, NO temperature/top_p on Fable 5/Opus 4.8/4.7,
  omit `thinking` entirely instead of disabling on Fable 5; system-prompt
  `cache_control` breakpoint when `cacheSystemPrompt` is set. Normalize each
  provider's usage fields into the existing `LlmUsage` shape (extend the R1
  pricing fixtures with one direct-shape case per provider).
- [ ] **Step 3.4:** `retry.ts`: exponential backoff + full jitter, default 2
  retries (profile `tuning.llmMaxRetries`), retry-on: HTTP 429/5xx/timeouts/
  network errors; never retry 4xx validation errors. Providers call through
  it. Unit-test with a stubbed failing function (no network).
- [ ] **Step 3.5:** Wire `callLlm` shim: resolve binding → pick provider by
  `binding.transport ?? profile.transport.default` → `provider.call(...)` →
  existing cost/usage accounting against `ChatResult.pricingKey` (unchanged
  math — R1 tests must stay green).
- [ ] **Step 3.6:** `tests/unit/providers.test.ts` — option-mapping table
  tests for `direct.ts` (built request params per binding/params combo,
  using the model classes' invocation params without network) + an
  openclaw-adapter request-shape test mirroring the pre-refactor body.
- [ ] **Step 3.7:** Verify: `npm test` green. Manual spot check (requires
  rotated keys): `BUDGET=0.03 scripts/run-task.sh "What is 2+2?"` with a
  temporary profile whose `direct` role binds `claude-haiku-4-5` — confirm a
  live direct-transport answer + cost line.
- [ ] **Step 3.8:** Commit: `feat: ChatProvider seam — direct LangChain transport, openclaw adapter, retry layer`

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

- [ ] **Step 4.1:** `run-context.ts`: `runId` (crypto.randomUUID), profile
  name, start time; threaded via `configurable` beside the profile;
  `thread_id = runId`.
- [ ] **Step 4.2:** `node-lifecycle.ts`: `wrapNode(name, fn)` — debug log on
  enter; on exit log `{ node, runId, durationMs, costDeltaUsd, model? }`
  via `getLogger().child({module:"graph"})`, computing cost delta from
  `usageStats` before/after. Apply to every main-graph node registration in
  `build.ts` (swarm nodes optional — only if trivially identical).
- [ ] **Step 4.3:** Attach `SqliteSaver` (file under `.agent-runs.sqlite` or
  `reports/checkpoints.sqlite` — gitignored) to the main graph compile;
  `--resume <runId>` re-invokes with the same `thread_id` and no new task
  input; document the flag in `--help` output and README section.
- [ ] **Step 4.4:** `run-summary.ts`: build `RunSummary` exactly as spec
  §3.4 from final state + node-lifecycle records; write
  `reports/runs/<runId>.json` on success, budget-stop, AND the catch path in
  `main.ts` (status `failed`, partial usage included). Console report
  (`cli/report.ts`) now also prints `runId` + summary path on all paths.
- [ ] **Step 4.5:** `tests/unit/run.test.ts` — wrapNode timing/cost-delta
  accounting with a stub node; RunSummary writer on the three status paths
  (temp dir).
- [ ] **Step 4.6:** Verify: `npm test` green; kill a live run mid-flight
  (Ctrl-C after first node) → `reports/runs/<id>.json` exists with
  `status:"failed"` and partial cost.
- [ ] **Step 4.7:** Commit: `feat: run kernel — runId, sqlite checkpointer, per-node cost/timing, RunSummary artifact`

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

- [ ] **Step 5.1:** Write zod schemas mirroring the JSON shapes the existing
  parsers expect (router decision, architect decision incl. confidence,
  critic decision, tiebreaker, worker-kind selection). Source of truth = the
  current parser expectations + prompt contracts; do not change field names
  (prompt copy and parsers stay aligned — `.agent/code-guidelines.md` §6).
- [ ] **Step 5.2:** Direct provider: when `structuredSchema` is set, use the
  model's `withStructuredOutput(schema)` (native json_schema where
  supported; DeepSeek strict may need its beta endpoint — feature-flag per
  provider and fall back to JSON mode + text parsing when unsupported).
  OpenClaw transport ignores `structuredSchema` (text path).
- [ ] **Step 5.3:** Node call sites pass the schema; each parse site first
  uses `ChatResult.parsed` when present, else the existing text parser —
  the fallback ladder is preserved verbatim (R1 parser tests unchanged).
- [ ] **Step 5.4:** Replace hardcoded model-cascade prose in prompts with
  the profile's `prompts.cascadeNote` (byte-stable per profile — prompt
  cache anchors remain deterministic for a given profile). Verify no parser
  contract text changed.
- [ ] **Step 5.5:** `tests/unit/structured.test.ts` — schemas accept the
  fixtures used by R1 parser tests; parse-site precedence (parsed > text
  fallback) with stubbed `ChatResult`s.
- [ ] **Step 5.6:** Verify: `npm test` green; live spot check on a
  pure-reasoning task with a direct-transport profile.
- [ ] **Step 5.7:** Commit: `feat: native structured outputs with text fallback; profile-injected cascade prompts`

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
  pointer), `.agent/memory.md` (§ Architecture: profiles/providers note)

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
  `src/consts/openclaw.ts` + `src/tools/gateway.ts` (remove
  `DEFAULT_GATEWAY_TOKEN` fallback — token required for openclaw transport,
  clear error otherwise), `package.json` (exact-pin `openclaw`,
  `@langchain/*`, `typescript`; declare ripgrep requirement in README +
  preflight warn), `.github/workflows/ci.yml` (vitest e2e stage)

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
  `package.json`, `openclaw.config.json5` are refused.
- [ ] **Step 8.4:** Remove the token fallback: openclaw transport without
  `OPENCLAW_GATEWAY_TOKEN` now fails fast with a clear message (direct
  transport unaffected). Update `.env.example`.
- [ ] **Step 8.5:** Exact-pin `openclaw`, `@langchain/langgraph`,
  `@langchain/anthropic|openai|deepseek`, `typescript`, checkpoint-sqlite;
  `npm ci` clean; add a preflight `rg --version` check with a warning (not a
  crash) at swarm startup.
- [ ] **Step 8.6:** Verify: `npm test` green INCLUDING the offline e2e —
  this is the first time the full dual-graph path is exercised without
  credentials. Wire `tests/e2e` into CI.
- [ ] **Step 8.7:** Commit (two allowed):
  `feat: fake provider + offline full-graph e2e` and
  `chore(security): widen patch guards, require gateway token, pin deps`

**Verification boundary:** offline e2e green in CI without any secrets.

---

### Task R9: Live MVP validation + baseline tag

**Files:**
- Modify: `.agent/memory.md` (§2 architecture: profiles/providers/run
  kernel; §6 status), `.agent/tasks.md` (close R-schedule, promote backlog),
  `docs/reviews/2026-06-10-project-review.md` (append "post-refactor status"
  footnote), `README.md` (measured-cost table)
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
- [ ] **Step 9.4:** Update `.agent/memory.md` (architecture + status dated
  entry), close `.agent/tasks.md` R-items, append measured-cost table to
  README.
- [ ] **Step 9.5:** Verify: `npm test` green; all 9 live runs completed or
  explained; baseline bench report committed.
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
