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
- **Debate Chamber:**
  - `claudeArchitect`: Drafts or updates the architecture/code based on compressed context.
  - `openaiCritic`: Critiques the draft using a rolling window of debate history (to save tokens).
  - `smeTiebreaker`: Breaks the tie if a maximum debate loop count is reached without consensus.
- **Objective Verification (`verify`):** Tests the finalized code. Consensus != Correctness. An objective gate is needed to test output.

### Execution Layer (Swarm Sub-Graph)
Handles tool execution via the `OpenClaw` RPC bridge.
- **Lead Delegator:** Classifies and routes subtasks to specialized worker agents.
- **Specialized Workers:**
  - `codeExplorer`: Uses safe local `rg` wrappers for file discovery and code grep, with raw outputs stored as artifacts.
  - `infraOps`: Runs only allowlisted verification/build commands instead of executing natural-language user text.
  - `webResearcher`: Uses the canonical OpenClaw `web_search` tool through the bridge.
- **SOS Escalation Protocol:** 
  - If a worker fails, it branches based on failure type.
  - `reasoning` failures are escalated to an `smeOracle` which parses a condensed error essence and responds with advice. Control loops back to the worker.
  - `environment` failures (permissions, missing binaries) are escalated to `humanGate` for manual Human-In-The-Loop resolution.
- **Compressor (`workerCompress`):** Formats output structurally for the Firewall, preserving lossless raw outputs in an artifact store.

---

## 3. Technology Stack

- **Language:** TypeScript (ESM)
- **Framework:** `@langchain/langgraph`
- **Orchestrator Tooling Bridge:** OpenClaw (Internal Module). `src/tools/openclaw.ts` starts/probes a local loopback Gateway when needed, stores Gateway state in `.openclaw_state`, and calls `/v1/chat/completions` with `model: "openclaw/default"` plus `x-openclaw-model`. OpenClaw Gateway `/tools/invoke` is used only for tools actually available on that HTTP surface, currently `web_search`. Repository-local pseudo-tools (`run_tests`, `shell_exec`, `ast_read`, `find_files`, `grep_code`) are handled by deterministic local adapters with workspace path bounds, exact command allowlists, no shell interpolation, timeouts, and artifact storage.

---

## 4. Pending / Open Context

- **MVP Reached:** The project has an executable LangGraph `src/index.ts` entrypoint that ensures OpenClaw Gateway readiness, invokes the full graph, and reports final telemetry.
- **Validated locally:** `npx tsc --noEmit`, `npm test`, OpenClaw config validation, and a local `openclawRpc("run_tests")` smoke test pass. Full live end-to-end model execution still depends on valid provider credentials and a reachable OpenClaw Gateway/runtime.
- **Open implementation gap:** The debate loop now produces corrected drafts and runs objective typecheck verification, but it still does not apply generated code patches automatically. If true autonomous file mutation is required, add a guarded patch-application stage with review/verification gates.
