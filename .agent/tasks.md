# Project Tasks

- [x] Initial scaffold of LangGraph architecture
- [x] Typed Swarm and Graph states
- [x] Connect LLM apis to `callLlm` function (MVP configured with Opus, GPT-5.5, DeepSeek)
- [x] Implement robust `openclawRpc` wrapper
- [x] Create entrypoint (`src/index.ts`) for graph execution
- [x] Correct OpenClaw Gateway contract: `/v1/chat/completions`, `x-openclaw-model`, local Gateway lifecycle, and artifact storage
- [x] Replace invalid OpenClaw tool mappings with actual Gateway `/tools/invoke` usage for `web_search` plus safe local pseudo-tool adapters for repo operations
- [x] Adapt Main Graph to invoke the Swarm Sub-Graph with explicit state mapping instead of unsafe compiled-graph insertion
- [x] Add objective verification through `npm run typecheck` and make `npm test` a real check
- [x] Audit & harden control flow: bound the context-refetch loop (`MAX_CONTEXT_FETCHES`) and verify/fix loop (`MAX_VERIFY_ATTEMPTS`) to stop frontier-token burn and recursion-limit crashes
- [x] Fix `humanGate` crash (`interrupt()` without a checkpointer) — block gracefully on environment failures
- [x] Skip meaningless typecheck verification for `pure_reasoning`; guard `undefined` `compressedContext`; raise `recursionLimit` to preserve telemetry
- [ ] Add guarded patch-application stage if the framework should mutate repository files autonomously instead of returning draft patches
- [ ] Wire a real HITL channel (compile swarm with a checkpointer + caller resume loop) to restore `humanGate` interrupt-based escalation
