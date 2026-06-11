# ai-agents-assitant

An autonomous development agent built on `@langchain/langgraph` (TypeScript). It
runs a **dual-graph** architecture: a Main Graph that routes a task through
routing, architecture, coding, multi-critic debate, patch application, and
verification nodes, delegating tool-heavy subtasks to a ReAct **Swarm Sub-Graph**
under a human-in-the-loop safety envelope. Which model serves which role is
configuration, not code (see `profiles/`).

## Quickstart

```bash
cp .env.example .env        # fill in the provider keys you need
npm install
npm start -- "<task description>"
```

Pick a model profile with the `--profile` flag or the `AGENT_PROFILE` env var
(the flag wins; both accept a name under `profiles/` or a `.json5` path):

```bash
npm start -- --profile research-playground "Summarize: <one paragraph>"
```

For guarded experimentation use the wrapper, which sets a conservative cost
budget (default $0.05) and keeps patch writes off unless asked:

```bash
PROFILE=personal-dev BUDGET=0.25 APPLY=1 HITL=0 scripts/run-task.sh "<task>"
```

`AGENT_COST_BUDGET_USD` overrides the active profile's budget and
`AGENT_APPLY_PATCHES` enables writing verified changes to the repository. See
`npm start -- --help` for the full usage.

## Profiles

A profile is a `json5` file binding the four **model tiers** to concrete models;
the graph's eight **roles** (router, firewall, worker, coder, reasoner,
architect, critic, sme) resolve to tiers through a code-owned default map, so
swapping the whole cascade means editing four lines. Shipped profiles:

| Profile               | Cascade                                                                                   | Budget |
| --------------------- | ----------------------------------------------------------------------------------------- | ------ |
| `default`             | Pre-refactor replica on the OpenClaw gateway transport                                    | $1.00  |
| `personal-dev`        | Quality-first: Sonnet advises/codes, Haiku routes, Fable 5 gated, GPT cross-family critic | $2.00  |
| `research-playground` | DeepSeek-heavy default cascade on the direct transport — copy, edit four tier lines, run  | $1.00  |
| `client-baseline`     | Predictable: DeepSeek Flash routes, Sonnet codes, Opus advises/arbitrates                 | $0.50  |

Profile anatomy (validated by zod at load; see
`docs/superpowers/specs/2026-06-11-model-tiers-design.md`):

```json5
{
  name: "example",
  transport: { default: "direct" }, // or "openclaw"
  // REQUIRED: all four tiers, each a full binding (provider, model, params?).
  tiers: {
    frontier: { provider: "anthropic", model: "claude-fable-5", params: { thinking: "adaptive" } },
    adviser: { provider: "anthropic", model: "claude-sonnet-4-6" },
    skilled: { provider: "anthropic", model: "claude-sonnet-4-6" },
    worker: { provider: "anthropic", model: "claude-haiku-4-5" },
  },
  // OPTIONAL per-role overrides: a full binding (bypasses tiers) or { tier, params? }.
  roles: { critic: { provider: "openai", model: "gpt-5.5" } },
  budget: { costBudgetUsd: 1 }, // soft USD ceiling, AGENT_COST_BUDGET_USD wins
  tuning: { maxDebateIterations: 4 }, // optional caps, defaults in src/consts/tuning.ts
  prompts: { cascadeNote: "..." }, // cascade prose injected into reasoning prompts
}
```

Default role→tier map: router/firewall/worker → `worker`, coder → `skilled`,
reasoner/architect/critic → `adviser`, sme → `frontier` — the top tier runs only
behind escalation gates. Every `model` value must have an entry in
`src/consts/pricing/model-pricing.json` (it doubles as the cost-accounting key);
profiles without one are rejected at load.

## Transports

Each binding's transport (`binding.transport ?? transport.default`) picks how
the call is made:

- `direct` — provider SDKs via LangChain (Anthropic/OpenAI/DeepSeek). Requires
  the provider API keys from `.env`; models use **bare provider-native ids**
  (`claude-haiku-4-5`, no `provider/` prefix). Native structured outputs,
  adaptive thinking, and reasoning effort are mapped per provider.
- `openclaw` — the legacy local OpenClaw gateway; models use gateway-prefixed
  ids (`anthropic/claude-opus-4-8`) and the gateway holds the keys
  (`OPENCLAW_GATEWAY_TOKEN` required).

Retries (exponential backoff + full jitter on 408/429/5xx/timeout/network) and
cost accounting are transport-independent.

## Resume

```bash
npm start -- --resume <runId>
```

The Main Graph checkpoints to a `SqliteSaver` at `reports/checkpoints.sqlite` with
`thread_id = runId`. Resuming re-enters the same checkpointed thread and takes no
new task input. The `<runId>` must be the UUID printed by the original run; any
runId without a checkpoint is rejected.

## Run artifacts

Every termination path writes a machine-readable `RunSummary` to
`reports/runs/<runId>.json` - on `completed`, `budget_stopped`, and `failed`
(including SIGINT) runs, with partial cost/usage on the failure paths. The
`runId` and summary path are also printed to the console. The whole `reports/`
tree is gitignored.

## Programmatic API and bench

`runAgentTask(task, { profile, budgetUsd, applyPatches, hitl: "off" })` (exported
from the root barrel) runs one full agent task in-process and resolves with the
`RunSummary` on every terminal path - the CLI in `src/main.ts` is a thin wrapper
over the same kernel. The promptfoo smoke bench rides it:

```bash
npm run bench                                   # 6-task smoke suite, profile "default"
PROFILE=research-playground npm run bench       # profile passthrough
npm run bench -- --filter trivial               # subset by test description
```

Results land in `reports/bench/<timestamp>/` (`results.json` + a generated
`summary.md` table with per-task cost/latency/tokens). See
[bench/README.md](bench/README.md) for suite anatomy and requirements.

## Contributing

Profiles live in `profiles/*.json5` (selected via `--profile`/`AGENT_PROFILE`).
Durable project knowledge - architecture, guidelines, the layer DAG (ADR-001),
and the refactor schedule - lives in `.agents/`; start at `.agents/README.md`.
