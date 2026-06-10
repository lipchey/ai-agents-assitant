# Project Facts - `ai-agents-assitant`

First file of the future `.agents/` knowledge directory (Gate 0a draft).
S7 completes the directory and migrates the legacy `.agent/` dir; until then
this file stands alone and does not assume sibling `.agents/` files exist.

## Repository Role
TypeScript multi-agent assistant service built on `@langchain/langgraph`.
It is a dual-graph autonomous development agent: a Main Graph for
orchestration plus a Swarm Sub-Graph. It runs via `tsx src/main.ts`, drives
Anthropic / OpenAI / DeepSeek models through a local OpenClaw gateway, and
uses Tavily (primary) with DuckDuckGo (fallback) for web search.
Capabilities include tool use, human-in-the-loop (HITL), guarded patch
application, and structured logging.

## Canonical Files
- `AGENTS.md` / `CLAUDE.md` - thin routers; currently point at the legacy
  `.agent/` dir (migrates to `.agents/` in S7).
- `package.json` - npm scripts, deps, and `engines` Node range.
- `tsconfig.json` - TypeScript compiler config (`outDir: dist`).
- `eslint.config.js` - flat ESLint config incl. local `block-comments-only`
  rule.
- `.prettierrc.json` / `.prettierignore` / `.editorconfig` - formatting.
- `openclaw.config.json5` - OpenClaw gateway, agents, plugins, tools config.
- `src/main.ts` / `src/index.ts` - entrypoints.
- `.agent/` - current (legacy) canonical agent-knowledge dir.

## Sensitive Paths
Changes here should trigger at least a lightweight review:
- `.github/workflows/**`
- `.githooks/**` (future)
- `verify` (future)
- `tools/**` (future top-level skill-owned dir; NOT `src/tools/`, which is
  application code)
- `openclaw.config.json5` (holds a gateway token literal)
- `openclaw.config.json5.last-good` (snapshot of the above; same token)
- `src/consts/openclaw.ts` (holds the same token literal as
  `DEFAULT_GATEWAY_TOKEN`; `src/tools/gateway.ts` wires it as the live env
  fallback - see Gate 0a D4 in the meta repo's `docs/quality-baseline.md`)
- `.env*`
- `scripts/run-task.sh`

## No-Touch Zones
The future repo-local `deep-review-refactor` skill must never autonomously
edit these paths; findings here are emitted as a plan, not a fix. This list
extends the skill-owned baseline (`.githooks/`, `.github/workflows/`,
`./verify`, `tools/`, `auth/**`, `credentials/**`) and cannot shrink it.
Repo-specific additions:
- `openclaw.config.json5` (and `openclaw.config.json5.last-good`)
- `.env*`

## Generated Or Transient Paths
- `dist/` - TypeScript build output (`tsconfig` `outDir`); gitignored.
- `.codegraph/` - local CodeGraph index; gitignored.
- `.openclaw_state/` - OpenClaw runtime state; gitignored.
- `reports/quality/` - quality-runner output (future; will be gitignored).

## Known False Positives
Pointer only. Accepted tool/review false positives will live in
`.agents/known-false-positives.md`, which S7 creates; it is seeded empty for
now (no entries yet).

## Verification Surface
Current: `npm test` runs the chain
`npm run typecheck && npm run lint && npm run smoke`, where
`npm run smoke` runs the six smoke scripts in order: `smoke:react`,
`smoke:patch`, `smoke:hitl`, `smoke:websearch`, `smoke:verify-report`,
`smoke:logging`. `typecheck` is `tsc --noEmit`; `lint` is `eslint .`.
Target: a `./verify` runner with `--staged`, `--fast`, and `--full` scopes,
arriving in S6.

## Layer Facts (draft)
Draft pending owner decision D3; to be corrected against the measured
dependency-cruiser graph (S5 measurement battery).

| Layer | Modules | May import from |
|---|---|---|
| L0 foundation | `src/types`, `src/consts` | (nothing) |
| L1 base | `src/shared`, `src/state`, `src/prompts`, `src/logging` | L0 |
| L2 capabilities | `src/tools`, `src/hitl`, `src/patching` | L0-L1 |
| L3 orchestration | `src/swarm`, `src/graph` | L0-L2, and `graph -> swarm` (never `swarm -> graph`) |
| L4 composition | `src/cli`, `src/main.ts`, `src/index.ts` | L0-L3 |

Note: `ls src/` confirms all listed module dirs exist; there are no extra
top-level `src/` dirs (only files `src/index.ts` and `src/main.ts` beyond
them). No discrepancies at draft time.
