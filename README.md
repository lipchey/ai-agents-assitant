# ai-agents-assitant

An autonomous development agent built on `@langchain/langgraph` (TypeScript). It
runs a **dual-graph** architecture: a Main Graph that routes a task through
routing, architecture, coding, multi-critic debate, patch application, and
verification nodes, delegating tool-heavy subtasks to a ReAct **Swarm Sub-Graph**
under a human-in-the-loop safety envelope. Which model serves which role is
configuration, not code (see `profiles/`).

## Run

```bash
npm start -- "<task description>"
```

The active profile is selected with `AGENT_PROFILE` (a name under `profiles/` or a
path); `AGENT_COST_BUDGET_USD` overrides the profile budget and
`AGENT_APPLY_PATCHES` enables writing verified changes to the repository. See
`npm start -- --help` for the full usage.

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

## Contributing

Profiles live in `profiles/*.json5` (selected via `AGENT_PROFILE`). Durable
project knowledge - architecture, guidelines, the layer DAG (ADR-001), and the
refactor schedule - lives in `.agents/`; start at `.agents/README.md`.
