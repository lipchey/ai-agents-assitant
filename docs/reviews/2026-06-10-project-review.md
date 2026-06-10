# Project Review — `ai-agents-assitant` (2026-06-10)

Deep review ahead of the boilerplate refactor. Method: two independent Opus
code-review passes (architecture; quality/runnability), one tooling research
pass (web-verified), synthesized and spot-checked by the main session. All
claims carry `file:line` anchors from the review date.

Companion documents:
- Design spec: [docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md](../superpowers/specs/2026-06-10-boilerplate-refactor-design.md)
- Implementation plan: [docs/superpowers/plans/2026-06-10-boilerplate-refactor.md](../superpowers/plans/2026-06-10-boilerplate-refactor.md)

---

## Резюме (UA)

Кодова база значно краща, ніж очікуєш від проєкту, що жодного разу повноцінно
не запускався: реальна шарова архітектура (L0–L4 підтверджена імпортами),
чистий `ToolRegistry` з DI, надійні parser-фолбеки, дисципліна констант,
робочий патч-механізм із rollback. Це хороша основа для бойлерплейта.

Головні проблеми:
1. **Живі API-ключі лежать у робочій копії `.env`** (не в git, але їх треба
   вважати скомпрометованими і ротувати до будь-якої роботи).
2. **Зв'язки роль→модель захардкоджені** (`switch` у `tools/models.ts`) — те,
   що бойлерплейт мусить винести в конфіг-профілі, сьогодні неможливе без
   правки коду.
3. **`callLlm` намертво прив'язаний до OpenClaw**; при цьому OpenClaw — це
   персональний AI-асистент Штайнбергера (месенджер-платформа), а не
   LLM-роутер. Залежність ризикова; план — провайдерний інтерфейс з
   `direct`-транспортом за замовчуванням і OpenClaw як legacy-адаптером.
4. **Нульова стійкість до збоїв**: жодного retry на LLM-виклики, жоден вузол
   main graph не ловить помилки, checkpointer відсутній — один транзієнтний
   429 вбиває весь дорогий запуск без можливості відновлення.
5. **Найризиковіша логіка не покрита тестами** (бюджет, прайсинг, ескалації,
   ReAct-цикл, rollback у finalize); немає unit-фреймворка взагалі.

План рефакторингу: 9 сесій R1–R9 (див. plan), виконуються через cmux-пайплайн
Fable 5 → Codex review → Opus 4.8 fix (див. `.agents/session-protocol.md`).

---

## 1. What is genuinely good (preserve in the refactor)

1. **Layering is real.** The L0–L4 table in `.agents/project-facts.md` holds
   against actual imports; the only exceptions are two type-only upward
   re-exports (`src/types/prompts.ts:1`, `src/types/swarm/react.ts:2`),
   erased on emit. `swarm` never imports `graph`; `graph → swarm` happens in
   exactly one place (`src/graph/nodes/swarm-node.ts:5`).
2. **ToolRegistry seam** (`src/tools/registry.ts:34-154`) — injectable
   providers/bindings/policy, duplicate-id detection, catalogs derived from
   active bindings, structured `ToolError` kinds routed to HITL vs reasoning
   (`src/swarm/tool-validation.ts:37-65`). Reusable as-is.
3. **Degrade-don't-crash parsers** — balanced-brace JSON extraction
   (`src/shared/json.ts`) plus heuristic/regex/confidence fallbacks at every
   parse site (`src/graph/parsers.ts:11-76`, `swarm/tool-validation.ts:10-25`).
4. **Tool-execution safety envelope** — `resolveWorkspacePath` escape check,
   `shell:false` fixed-arg spawns, bounded output, SIGTERM→SIGKILL, command
   allowlist double-validation (`src/consts/tools.ts:81-95`).
5. **Patch apply/rollback mechanics** (`src/patching/patch-blocks.ts`) —
   pristine snapshots, created-file tracking, retry-safe `alreadyHandled`,
   full restore on failed verification.
6. **Logging machinery** (`src/logging/*`) — leveled logger, pluggable sinks,
   user-output separation, safe formatters. Machinery is solid; coverage is
   thin (§6).
7. **Cost-aware cascade design** — soft USD budget + hard loop caps + routed
   escalation is the project's core value and the right shape for all three
   target products. It needs tests and per-node attribution, not redesign.
8. **Consts discipline** — single-definition `as const` + union pattern;
   `ModelRef` byte-equal to pricing keys (verified).

## 2. Architecture vs the boilerplate goal

Target capability: per-deployment **profiles** (role→model bindings, params,
caps) without touching graph code. Ranked blockers found:

| # | Blocker | Where | Why it blocks |
|---|---|---|---|
| 1 | Role→model bindings are a hardcoded `switch` | `src/tools/models.ts:26-45`, `src/consts/models.ts:2-8` | No data structure or config seam to override; `callLlm(role)` resolves the model internally. Profiles are impossible today. |
| 2 | `callLlm` hardwires the OpenClaw transport | `src/tools/llm.ts:33-95` (body model `openclaw/default`, `x-openclaw-model`, `x-openclaw-agent-id`) | Direct provider calls / gateway replacement impossible. Mitigating fact: it is a *single* function behind all 12 LLM call sites — cheap to abstract. |
| 3 | Topology is imperative code | `src/graph/build.ts:25-87`, `src/swarm/build.ts:14-52` | Variants require code forks. Nodes/routers are already cleanly separated, so this is deferred, not urgent (spec D3). |
| 4 | Per-role LLM options inlined at call sites | e.g. `src/graph/nodes/architects.ts:27-29`, `critics.ts:27-32`, `swarm/react-worker.ts:98-101` | Rebinding a role to a model with different thinking/effort semantics means editing ~12 node files. |
| 5 | Prompts encode the model cascade in prose | `src/prompts/core.ts:20-29` (names DeepSeek/Opus/GPT-5.5 explicitly) | Any rebinding makes cache-anchored prompts factually wrong. |
| 6 | Dev gateway token baked in as live fallback | `src/consts/openclaw.ts:20` (`DEFAULT_GATEWAY_TOKEN` literal), wired in `src/tools/gateway.ts:34`; also `openclaw.config.json5:7` | Unacceptable default for a client-facing boilerplate. Already flagged by Gate 0a D4. |
| 7 | `GraphState` is one flat ~38-field bag | `src/state/graph-state.ts:8-110` | Product-specific signals all land in one shared root. Workable; namespacing is a later cleanup. |

Main-graph topology as implemented matches `.agent/memory.md` (verified node
by node); the doc compresses some budget short-circuits but contains no
contradictions.

## 3. The OpenClaw finding (dependency risk)

Web-verified: npm `openclaw` (the `^2026.6.1` dependency) is Peter
Steinberger's open-source **personal AI assistant / multi-channel messaging
platform** (Telegram/WhatsApp/Slack/...; deps like `grammy`, `qrcode`,
`express`). Its "Gateway" is that product's control-plane daemon, not a
purpose-built LLM router. It happens to expose `/v1/chat/completions` with
per-agent model routing, which this repo uses as its only model transport.

Consequences:
- The entire LLM path of this project rides an application platform that is
  large, fast-moving (CalVer, pushed daily), and steered by priorities
  unrelated to LLM routing (author joined OpenAI in 2026).
- Caret-pinned `^2026.6.1` can pull breaking gateway CLI/endpoint changes at
  any reinstall (`src/tools/gateway.ts:79-87` hardcodes its CLI flags).
- Provider features the boilerplate needs first-class — Anthropic
  `cache_control` breakpoints, native structured outputs, provider-typed
  errors — are mediated/obscured by the gateway's OpenAI-compatible shim.

Decision (spec D1): introduce a `ChatProvider` seam; default new profiles to
**direct provider SDKs** (`@langchain/anthropic` / `@langchain/openai` /
`@langchain/deepseek` via `initChatModel`); keep an `openclaw` adapter as a
legacy transport so the current local setup keeps working until parity is
confirmed.

## 4. Runnability & reliability

What a live run requires today: a task argv, the OpenClaw gateway bootable
(`node_modules/openclaw/openclaw.mjs gateway run`, 45 s readiness window,
`src/tools/gateway.ts:89-151`), provider keys in the gateway's env, and
`rg` (ripgrep) on PATH for `find_files`/`grep_code`
(`src/tools/local-tools.ts:112,140` — undeclared dependency).

Findings:
- **No retries on LLM calls.** `callLlm` makes one `jsonPost` (180 s timeout)
  and throws on any failure or empty content (`src/tools/llm.ts:86-91`).
- **No node-level error handling in the main graph.** All main-graph LLM
  nodes call `callLlm` without try/catch; only the swarm worker
  (`react-worker.ts:102-106`) and `leadDelegator` (`swarm/nodes.ts:62-64`)
  catch. One transient 429/5xx at any main-graph LLM node aborts the run.
- **No checkpointer on the main graph** (`src/graph/build.ts:86` compiles
  bare). A crashed run is unresumable and its cost telemetry is lost
  (report printed only on success path, `src/cli/report.ts`). The swarm's
  fresh `MemorySaver` per invocation (`src/swarm/build.ts:51`) is fine and
  intentional (HITL checkpoint isolation).
- Parsers themselves never crash on malformed output (§1.3) — the brittleness
  is upstream (transport) and around (no retry/resume), not in parsing.

## 5. Security

- **BLOCKER — live keys in working-tree `.env`** (Anthropic/OpenAI/DeepSeek/
  Tavily). The file is gitignored and not in history (verified), but it sits
  in a directory about to be copied/turned into a boilerplate. **Rotate all
  four keys before R1.** Action R0 in the plan.
- Hardcoded default gateway token (see blocker #6). Loopback bind is
  the only mitigation today. Remove the in-code fallback (plan R8).
- **Patch protected-path list too narrow.** `PROTECTED_SEGMENTS = {.git,
  node_modules}` (`src/consts/patching.ts:5`); with patches enabled the model
  may overwrite `.github/workflows/*`, `.env`, `package.json`,
  `openclaw.config.json5` — exactly the sensitive paths
  `.agents/project-facts.md` enumerates. Widen (plan R8).
- Shell/workspace envelope itself is sound (§1.4).

## 6. Tests, CI, observability

- **No unit-test framework.** `npm test` = typecheck + lint + 6 smoke scripts
  (`node:assert`). Smokes are decent integration probes but the riskiest
  logic has zero coverage: budget math (`src/graph/budget.ts`), usage/pricing
  normalization (`src/tools/pricing.ts:22-105` — most complex code in the
  repo), the ReAct loop body (`runReactWorker`), escalation routing
  (`graph/routing.ts`, `swarm/routing.ts`), finalize rollback wiring
  (`graph/nodes/finalize.ts`). `gateway-smoke.ts` is orphaned (in no npm
  script).
- **CI** (`.github/workflows/ci.yml`): push-to-main + PRs, single Node
  24.15.0 (engines claim three ranges), `npm ci && npm test`, fully offline.
- **Observability**: logging machinery exists but only 2 modules emit
  (`main.ts`, `web-search.ts`). No run-id, no per-node cost/duration events,
  no machine-readable usage export, nothing tying a main run to its swarm
  sub-runs. For benchmark work this must exist (plan R4).

## 7. Dependencies

- `openclaw ^2026.6.1` — highest risk (§3). Pin exact while it remains.
- `@langchain/langgraph ^1.3.5` — fine (1.3.7 latest; v1 API stable). Pin
  tighter; adopt `SqliteSaver` (`@langchain/langgraph-checkpoint-sqlite`).
- `@langchain/anthropic` / `@langchain/openai` — currently **unused** (all
  traffic goes through the gateway); become load-bearing in R3. Add
  `@langchain/deepseek`.
- `typescript ^6.0.3` — new major; pin.
- Undeclared runtime dep: ripgrep (document or fallback).

## 8. Recommendation summary

Refactor, don't rewrite. The expensive-to-get-right parts (layering, tool
seam, parsers, safety envelope, patching) are already good; every blocker is
concentrated in a contained surface (`tools/models.ts`, `tools/llm.ts`, node
call-site options, consts→profile lift). The design spec defines the target
(profiles + provider seam + reliability kernel + bench harness); the plan
slices it into 9 single-session tasks (R1–R9) executed through the
Fable → Codex → Opus review pipeline in `.agents/`.
