# `ai-agents-assitant` Guidelines

## 1. LangGraph Patterns

- **State Definition**: Always use `@langchain/langgraph`'s `Annotation.Root` for state definitions (e.g., `GraphState`, `SwarmWorkerState`). Ensure all properties have appropriate reducers if they mutate (like arrays and dictionaries).
- **Graph Assembly**: Use builder chaining (`new StateGraph(State).addNode(...).addEdge(...)`) to preserve strict typing.
- **Node Inputs/Outputs**: Return strictly typed partial state updates from nodes. Avoid using `any` unless absolutely necessary to bypass LangGraph compiler limitations.

## 2. Code Style

- **TypeScript First**: Enforce strict typing. Do not use generic objects when an interface or `typeof State.State` can be used.
- **ESM Syntax**: This project is configured as `type: module` with TypeScript `bundler` resolution. Use explicit `.ts` extensions for concrete local TypeScript file imports (e.g., `import { foo } from "./state/graph-state.ts";`), but import `index.ts` barrels from the owning folder (e.g., `import { foo } from "./state";`). `rewriteRelativeImportExtensions` rewrites concrete `.ts` imports to `.js` on emit.
- **Closed value sets**: Rely on defined const objects (`WorkerStatus`, `FailureType`, `WorkerKind`) and their union types instead of scattered booleans/strings for control flow.

## 3. Operations & Memory Automation

- **MEMORY AUTOMATION**: Before completing any task, you MUST update `.agent/memory.md` under the "Pending / Open Context" section if there are unresolved issues, or under "Architecture" if structural changes were made.
- **Task Tracking**: Keep `.agent/tasks.md` up to date by marking items as `[x]` when completed.
- **Testing**: Run `npx tsc --noEmit` before committing any code to ensure graph typings are perfectly aligned.
- **Verification surface**: `./verify --staged` runs on pre-commit; `./verify --fast` is the pre-push gate and the agent handoff check before declaring work done. Install the hooks once per clone with `git config core.hooksPath .githooks`.
- **Git Workflow**: This is a single-developer repository. Commit directly to `main` — do NOT create feature branches or open PRs unless explicitly asked. Commit only when the developer asks.
