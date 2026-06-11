# Boilerplate Refactor — Design Spec (2026-06-10)

Turns `ai-agents-assitant` into a modular multi-LLM agent boilerplate. Read
with the review ([docs/reviews/2026-06-10-project-review.md](../../reviews/2026-06-10-project-review.md))
and the plan ([../plans/2026-06-10-boilerplate-refactor.md](../plans/2026-06-10-boilerplate-refactor.md)).

## 1. Context and goals

One codebase must power three products:

1. **personal-dev** — autonomous multi-agent coding system for the owner;
   quality-first with budget gates; Claude Fable 5 available behind
   escalation; minimal human intervention.
2. **research-playground** — experiments combining diverse LLMs for the best
   cost/quality ratio; needs cheap profile swaps and comparable metrics.
3. **client-baseline** — template for client-specific tuned deployments;
   "expensive-model quality at a lower price"; must be safe to hand off.

The differentiator between products is **configuration, not code**: which
model serves which role, with which parameters, caps, budgets, and tool
policy. Everything product-specific must live in a profile; the graph code
stays shared.

**MVP definition (exit criterion of the plan):**
`npm start -- --profile <name> "<task>"` completes a live end-to-end run on
all three example profiles; `npm run bench` executes a smoke suite against a
profile and emits comparable cost/quality/latency reports; the full offline
test battery (`npm test`) covers the previously untested risk paths and a
no-network full-graph e2e.

**Explicitly out of scope (this refactor):**
- Optimizing inter-model interaction quality (prompt tuning, cascade
  thresholds) — separate later effort; benches built now are its tooling.
- Declarative/topology-as-config graph variants (D3).
- Langfuse/OTel integration (hooks only — D9), MCP/A2A exposure.
- `.agent/` → `.agents/` knowledge migration and the `./verify` runner
  adoption — owned by the meta-repo's sessions S6–S8; this plan must not
  collide with them (D12).

## 2. Decisions

- **D1 — Provider seam, gateway optional.** Introduce a `ChatProvider`
  interface with two implementations: `direct` (LangChain `initChatModel`
  over `@langchain/anthropic`, `@langchain/openai`, `@langchain/deepseek`)
  and `openclaw` (adapter extracted from the current `src/tools/llm.ts`).
  New profiles default to `direct`. Rationale: review §3 — OpenClaw is an
  AI-assistant platform, not an LLM router; direct SDKs unlock native
  `cache_control`, structured outputs, typed errors, and remove a
  fast-moving dependency from the hot path. The adapter keeps the current
  local setup working; its removal is a backlog decision after parity.
- **D2 — Profiles are JSON5 + zod.** `profiles/<name>.json5`, validated by a
  zod schema at load. JSON5 (already in the repo via openclaw config) allows
  comments; data files are client-shippable and serializable into bench
  reports. Selected via `--profile <name|path>` or `AGENT_PROFILE`.
- **D3 — Profile scope = bindings, params, caps, policy. Topology stays
  code.** Nodes and routers are already cleanly separated; topology variants
  are a later, separate mechanism. YAGNI for the MVP.
- **D4 — Checkpointing.** `SqliteSaver`
  (`@langchain/langgraph-checkpoint-sqlite`) on the main graph,
  `thread_id = runId`, `--resume <runId>` CLI flag. The swarm keeps its
  per-invocation `MemorySaver` (intentional HITL isolation).
- **D5 — Retries at the provider layer.** Exponential backoff + jitter on
  429/5xx/network/timeout, default 2 retries (profile-tunable). After
  retries, errors still propagate (fail fast) — but the run is now resumable
  via D4 and reports cost on the failure path.
- **D6 — Structured outputs, native-first with fallback.** On `direct`
  transport, decision-shaped calls use `withStructuredOutput(zodSchema)`
  (provider-native json_schema where supported). The existing defensive text
  parsers are kept as the universal fallback and remain the only path on the
  `openclaw` transport. DeepSeek strict mode may need its beta endpoint —
  guard per provider.
- **D7 — Bench harness = promptfoo + a programmatic agent entrypoint.**
  New `runAgentTask(task, options) → RunSummary` API; a promptfoo custom JS
  provider wraps it; suites live in `bench/`; programmatic asserts
  (contains/javascript/exit-code on fixtures) plus `llm-rubric` judges;
  cost/latency assertions native to promptfoo. Reports under
  `reports/bench/` (gitignored).
- **D8 — vitest for unit tests.** Smoke scripts remain as integration
  probes. `npm test` = typecheck → lint → vitest → smoke.
- **D9 — Run observability.** Every run gets a `runId`; a node lifecycle
  wrapper logs enter/exit, duration, and per-node cost delta through the
  existing logger; a machine-readable `RunSummary` JSON is written to
  `reports/runs/<runId>.json` (gitignored) on success AND failure. A
  `callbacks` hook param reserves the seam for Langfuse later (backlog).
- **D10 — Security hardening.** Rotate the leaked keys (R0, manual); delete
  the `DEFAULT_GATEWAY_TOKEN` in-code fallback (token becomes required when
  transport=openclaw); widen `PROTECTED_SEGMENTS` to cover
  `.github`, `.githooks`, `.env*`, `openclaw.config.json5*`,
  `package.json`, `package-lock.json`, `tsconfig.json`.
- **D11 — Execution pipeline.** Refactor sessions R1–R9 run as independent
  Claude Code (Fable 5) sessions (typically in cmux panes), each ending with
  the in-session cross-runtime review chain: headless **Codex** (GPT 5.5)
  reviews the session diff → an **Opus 4.8 subagent** verifies and fixes
  confirmed P1/P2 → Codex re-reviews the fix delta. Protocols live in
  `.agents/session-protocol.md`, `.agents/review-chain.md`,
  `.agents/model-roles.md`; live state in `.agents/handoffs/STATE.md`.
- **D12 — No collision with the meta-repo.** Sessions are numbered `R<n>`
  (the meta-repo owns `S<n>`). Verification boundary is `npm test` until the
  meta-repo's S6 lands `./verify` in this repo; the protocol then switches
  to `./verify --fast`.

## 3. Target architecture

### 3.1 Module map (changes only)

```
src/
├── models/                  # NEW subsystem (L2, may import L0-L1)
│   ├── index.ts             # barrel
│   ├── profile.ts           # Profile/ModelBinding types + zod schema + loader
│   ├── provider.ts          # ChatProvider interface + ChatCallOptions/ChatResult
│   ├── providers/
│   │   ├── direct.ts        # initChatModel-based provider (anthropic/openai/deepseek)
│   │   ├── openclaw.ts      # legacy adapter (logic extracted from tools/llm.ts)
│   │   └── fake.ts          # deterministic scripted provider for offline e2e
│   ├── retry.ts             # backoff wrapper used by providers
│   └── resolve.ts           # resolveBinding(role, profile), pricing-key checks
├── run/                     # NEW (L3): run identity + summary
│   ├── run-context.ts       # runId, profile ref, started-at; threaded via configurable
│   ├── node-lifecycle.ts    # wrapNode(name, fn): timing + cost-delta + logging
│   └── run-summary.ts       # RunSummary type + writer (reports/runs/<runId>.json)
├── tools/llm.ts             # becomes a thin shim: resolve binding → provider.call
├── graph/build.ts           # nodes wrapped with node-lifecycle; SqliteSaver attached
├── cli/                     # --profile / --resume flags; failure-path report
profiles/                    # NEW: personal-dev.json5, research-playground.json5,
                             #      client-baseline.json5, default.json5
bench/                       # NEW: promptfooconfig.yaml, provider.ts (or .mjs),
                             #      suites/, fixtures/<mini-repo>/
tests/                       # NEW: vitest unit + offline e2e specs
reports/                     # gitignored: runs/, bench/
```

Layer placement: `src/models/` sits at L2 (like `tools/`); `src/run/` at L3.
`callLlm`'s public signature is preserved so the 12 call sites do not churn
in R2/R3; it becomes a wrapper that resolves the binding from the active
profile and delegates to the bound provider.

### 3.2 Profile contract (pinned)

> **Amendment (2026-06-11, session R6a):** superseded by the tier-format
> contract v2 in
> [2026-06-11-model-tiers-design.md](2026-06-11-model-tiers-design.md) —
> profiles now define a required `tiers` block
> (frontier/adviser/skilled/worker) and `roles` becomes an optional override
> map; `ModelRole.FRONTIER` is renamed to `REASONER`. The text below is the
> v1 contract, kept for history; loader-validation principles (fail fast,
> pricing entries, transport-id checks) carry over.

All 8 existing `ModelRole` values are required keys; the loader fails fast on
a missing role, an unknown provider, or a `model` string without a pricing
entry in `src/consts/pricing/model-pricing.json`.

```json5
// profiles/personal-dev.json5 (illustrative defaults; tuning comes later)
{
  name: "personal-dev",
  description: "Quality-first personal dev system; Fable 5 behind escalation gates.",
  transport: { default: "direct" },          // "direct" | "openclaw"
  roles: {
    // key set = existing ModelRole union (loader validates exhaustively)
    router:    { provider: "anthropic", model: "claude-haiku-4-5",  params: { temperature: 0 } },
    firewall:  { provider: "anthropic", model: "claude-haiku-4-5" },
    worker:    { provider: "anthropic", model: "claude-haiku-4-5" },
    frontier:  { provider: "anthropic", model: "claude-sonnet-4-6", params: { thinking: "adaptive" } },
    coder:     { provider: "anthropic", model: "claude-sonnet-4-6", params: { thinking: "adaptive" } },
    sme:       { provider: "anthropic", model: "claude-fable-5",    params: { thinking: "adaptive", reasoningEffort: "high" } },
    openaiCritic: { provider: "openai", model: "gpt-5.5" },
    direct:    { provider: "anthropic", model: "claude-haiku-4-5" },
  },
  budget: { costBudgetUsd: 2.0 },
  tuning: {                                   // every key optional; defaults = current consts
    confidenceEscalationThreshold: 0.72,
    maxDebateIterations: 4,
    maxVerifyAttempts: 2,
    maxContextFetches: 2,
    maxPatchFormatRetries: 2,
    maxReactSteps: 6,
    llmMaxRetries: 2,
  },
  workerTools: {},                            // optional WORKER_TOOLS overrides
  prompts: {
    // model-agnostic cascade description injected into prompt anchors,
    // replacing the hardcoded DeepSeek/Opus/GPT prose (review blocker #5).
    cascadeNote: "Cheap models route and compress; stronger models architect and review; the strongest run only behind escalation gates.",
  },
}
```

Notes: role keys above are illustrative — R2 derives the exact key set from
the real `ModelRole` union. Anthropic params honor current API semantics
(adaptive thinking; no temperature when thinking is on; Fable 5 rejects an
explicit thinking:disabled — omit instead). `model` doubles as the pricing
key: R3 adds `claude-fable-5` ($10/$50 per MTok, cache write ×1.25, read
×0.1) and `claude-haiku-4-5` ($1/$5) entries, reusing existing entries for
DeepSeek/OpenAI; legacy `ModelRef` keys remain for the openclaw transport.

The other two example profiles: `research-playground` reproduces the current
DeepSeek-heavy cascade on `direct` transport (cheap experimentation
baseline); `client-baseline` = DeepSeek flash/pro for routing+frontier,
Sonnet 4.6 coder, Opus 4.8 SME, budget 0.50, no cross-family critic.
`default.json5` byte-replicates today's bindings on the `openclaw` transport
(zero behavior change until a profile is chosen).

### 3.3 Provider contract (pinned)

```ts
/* src/models/provider.ts — field shapes align with existing src/types in R3;
   the invariant is the seam, not the exact message type. */
export interface ChatCallOptions {
  temperature?: number;
  maxTokens?: number;
  thinking?: "adaptive" | "none";
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  responseFormat?: "text" | "json_object";
  structuredSchema?: ZodTypeAny;   /* when set and the provider supports it,
                                      ChatResult.parsed is the validated object */
  cacheSystemPrompt?: boolean;     /* anthropic cache_control breakpoint */
}

export interface ChatResult {
  text: string;
  parsed?: unknown;
  usage: LlmUsage;                 /* existing shape, src/types/usage.ts */
  pricingKey: string;              /* key used for cost lookup */
}

export interface ChatProvider {
  readonly kind: "direct" | "openclaw" | "fake";
  call(binding: ModelBinding, system: string, user: string,
       opts?: ChatCallOptions): Promise<ChatResult>;
}
```

Invariants: cost accounting stays in one place (the `callLlm` shim computes
cost from `usage` + `pricingKey` exactly as today); retry wrapping
(`src/models/retry.ts`) applies inside providers so callers never see
transient 429/5xx; the fake provider is deterministic (scripted
responses keyed by role/step) and performs no network I/O.

### 3.4 RunSummary contract (pinned)

```ts
export interface RunSummary {
  runId: string;
  task: string;
  profileName: string;
  status: "completed" | "budget_stopped" | "failed";
  answer: string;
  verificationPassed?: boolean;
  totalCostUsd: number;
  totalTokens: number;
  usageStats: UsageStats;          /* existing shape */
  durationMs: number;
  nodeVisits: Array<{ node: string; durationMs: number; costUsd: number }>;
  error?: string;
}
```

Written to `reports/runs/<runId>.json` on every termination path. This is
the object the bench provider consumes and the future optimization work will
regress against — treat it as a frozen contract after R4.

### 3.5 Bench harness

`bench/promptfooconfig.yaml` defines suites; a custom JS provider invokes
`runAgentTask` with the profile taken from the test vars, returning the
answer plus token/cost metadata from `RunSummary`. Smoke suite (6 tasks):
2 trivial (direct route), 2 pure-reasoning (architect route), 2 tool/code
tasks against `bench/fixtures/mini-ts-repo/` with programmatic asserts
(patch applied + `npx tsc --noEmit` exit 0 in the fixture). LLM-rubric
asserts judge answer quality on the reasoning tasks. Offline mode: the same
suite runs against the fake provider in CI to validate harness plumbing.

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Refactor breaks untested behavior | R1 locks budget/pricing/routing behavior in unit tests BEFORE any refactor |
| Direct transport diverges from gateway behavior (thinking, cache, usage fields) | `default.json5` keeps openclaw path byte-stable; R3 verifies usage-field normalization in `tools/pricing.ts` against fixtures per provider |
| DeepSeek structured-output quirks (beta endpoint) | D6 capability flags per provider; text-parser fallback always present |
| Profile sprawl / config drift | zod fail-fast validation; pricing-key check; profiles carry `name` into RunSummary and bench reports |
| Collision with meta-repo S6–S8 | D12: R-numbering, no `.agents/` knowledge migration here, verification command switchable |
| Session scope creep | session-protocol caps each R-session at its task's verification boundary; out-of-scope findings go to `.agent/tasks.md` backlog |

## 5. Execution

Nine sessions, R1–R9, defined in the plan. Each runs in a fresh Fable 5
session (cmux pane), follows `.agents/session-protocol.md`, ends at a green
verification boundary with pinned commits, and triggers the review chain
(`.agents/review-chain.md`: Codex review → Opus fix → Codex re-review).
Live state: `.agents/handoffs/STATE.md`. Schedule mirror:
`.agent/tasks.md` § Active.
