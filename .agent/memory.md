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
- **Context Firewall (`firewall`):** Compresses raw execution details into structured summaries, isolating expensive reasoning models from verbose tool outputs.
- **Debate Chamber:**
  - `claudeArchitect`: Drafts or updates the architecture/code based on compressed context.
  - `openaiCritic`: Critiques the draft using a rolling window of debate history (to save tokens).
  - `smeTiebreaker`: Breaks the tie if a maximum debate loop count is reached without consensus.
- **Objective Verification (`verify`):** Tests the finalized code. Consensus != Correctness. An objective gate is needed to test output.

### Execution Layer (Swarm Sub-Graph)
Handles tool execution via the `OpenClaw` RPC bridge.
- **Lead Delegator:** Classifies and routes subtasks to specialized worker agents.
- **Specialized Workers:**
  - `codeExplorer`: AST parsing and file system reads.
  - `infraOps`: Shell execution, Docker handling, adhering to ephemeral safety rules.
  - `webResearcher`: Browsing and documentation lookups.
- **SOS Escalation Protocol:** 
  - If a worker fails, it branches based on failure type.
  - `reasoning` failures are escalated to an `smeOracle` which parses a condensed error essence and responds with advice. Control loops back to the worker.
  - `environment` failures (permissions, missing binaries) are escalated to `humanGate` for manual Human-In-The-Loop resolution.
- **Compressor (`workerCompress`):** Formats output structurally for the Firewall, preserving lossless raw outputs in an artifact store.

---

## 3. Technology Stack

- **Language:** TypeScript (ESM)
- **Framework:** `@langchain/langgraph`
- **Orchestrator Tooling Bridge:** OpenClaw (Internal Module). Handles tool execution. Includes idempotency, retry/backoff, timeouts, and artifact storage to `.openclaw_artifacts`. Destructive operations require confirmation via LLM `requireConfirmation` argument.

---

## 4. Pending / Open Context

- **MVP Reached:** The project has an executable LangGraph `src/index.ts` entrypoint. `openclaw.ts` routes LLM calls to Anthropic (`claude-3-opus`), OpenAI (`gpt-5.5`), and DeepSeek (`deepseek-chat`). API keys are configured via `.env`.
- Expand tool usage for nodes inside `src/main.ts` so they pass structured tool arguments instead of string stubs if needed.
