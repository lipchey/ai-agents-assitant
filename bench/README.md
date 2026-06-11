# Bench harness

Promptfoo-based smoke bench over the dual-graph agent (design spec D7/§3.5).
A custom JS provider ([agent-provider.mjs](agent-provider.mjs)) calls the
programmatic entrypoint `runAgentTask(task, options)` in-process and maps the
frozen `RunSummary` contract onto promptfoo's result fields, so every task row
carries real cost, token, and latency numbers.

## Run it

```bash
npm run bench                                   # full smoke suite, profile "default"
PROFILE=research-playground npm run bench       # profile passthrough (run-task.sh convention)
npm run bench -- --filter trivial               # subset by test description (alias for --filter-pattern)
```

Each run writes `reports/bench/<timestamp>/` (gitignored) with:

- `results.json` — promptfoo's machine-readable eval output;
- `summary.md` — a generated per-task table (pass, score, cost, latency, tokens).

The runner pins `--max-concurrency 1` and `--no-cache`: agent runs are
non-deterministic, mutate local state, and must be measured, not replayed.

## Requirements

- Provider API keys in `.env` (the runner loads dotenv and the child process
  inherits it). The `llm-rubric` judge uses `deepseek:deepseek-v4-flash` and
  needs `DEEPSEEK_API_KEY`.
- `OPENCLAW_GATEWAY_TOKEN` — the default tool registry's web provider routes
  through the OpenClaw gateway, so runs still start it even on all-direct
  profiles.

## Suite anatomy ([suites/smoke.yaml](suites/smoke.yaml))

| group     | tasks | objective asserts                                        |
| --------- | ----- | -------------------------------------------------------- |
| trivial   | 2     | `contains`/`icontains` + cost + latency                  |
| reasoning | 2     | `llm-rubric` (cheap judge) + cost + latency              |
| coding    | 2     | patch applied + `tsc --noEmit` green in the fixture copy |

Coding tasks run against a disposable copy of
[fixtures/mini-ts-repo](fixtures/mini-ts-repo) (a tiny strict-TS package with
one deliberate compile error). The provider resets the copy under
`bench/.work/` (gitignored) before every call; the
[asserts/fixture-typecheck.mjs](asserts/fixture-typecheck.mjs) assert then
requires a real diff in the target file plus a green `tsc --noEmit` in the
copy. The repo's own gates never see the fixture: `bench/` is excluded from
the root tsconfig and the deliberately-broken fixture sources are
eslint-ignored.

## Caveats

- Latency includes runtime startup (tool registry and, when needed, the
  OpenClaw gateway) — thresholds in the suite are generous on purpose.
- The agent's internal `verify` node typechecks the host repo, not the
  fixture copy; the bench's `tsc` assert is the objective gate for coding
  tasks.
- `npm run bench -- --offline` is a guard that exits with an explanation: the
  offline suite needs the deterministic fake `ChatProvider` that lands in R8
  (see `.agents/tasks.md` § Backlog).
