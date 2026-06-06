# `ai-agents-assitant` Guidelines

## 1. LangGraph Patterns
- **State Definition**: Always use `@langchain/langgraph`'s `Annotation.Root` for state definitions (e.g., `GraphState`, `SwarmWorkerState`). Ensure all properties have appropriate reducers if they mutate (like arrays and dictionaries).
- **Graph Assembly**: Use builder chaining (`new StateGraph(State).addNode(...).addEdge(...)`) to preserve strict typing.
- **Node Inputs/Outputs**: Return strictly typed partial state updates from nodes. Avoid using `any` unless absolutely necessary to bypass LangGraph compiler limitations.

## 2. Code Style
- **TypeScript First**: Enforce strict typing. Do not use generic objects when an interface or `typeof State.State` can be used.
- **ESM Syntax**: This project is configured as `type: module`. Always use `.js` extensions in local imports (e.g., `import { foo } from "./state.js";`).
- **Enums**: Rely on defined enums (`WorkerStatus`, `FailureType`, `WorkerKind`) instead of scattered booleans for control flow.

## 3. Operations & Memory Automation
- **MEMORY AUTOMATION**: Before completing any task, you MUST update `.agent/memory.md` under the "Pending / Open Context" section if there are unresolved issues, or under "Architecture" if structural changes were made.
- **Task Tracking**: Keep `.agent/tasks.md` up to date by marking items as `[x]` when completed.
- **Testing**: Run `npx tsc --noEmit` before committing any code to ensure graph typings are perfectly aligned.
- **Git Workflow**: This is a single-developer repository. Commit directly to `main` — do NOT create feature branches or open PRs unless explicitly asked. Commit only when the developer asks.
