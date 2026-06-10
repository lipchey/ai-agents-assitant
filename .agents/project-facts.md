# Project Facts - `ai-agents-assitant`

Local facts, sensitive paths, no-touch zones, and the verification surface for
the pilot. Part of the canonical `.agents/` knowledge directory (the legacy
`.agent` dir was migrated in S7). Keep it current; route to ADRs rather than
duplicating decisions.

## Repository Role

TypeScript multi-agent assistant service built on `@langchain/langgraph`.
It is a dual-graph autonomous development agent: a Main Graph for
orchestration plus a Swarm Sub-Graph. It runs via `tsx src/main.ts`, drives
Anthropic / OpenAI / DeepSeek models through a local OpenClaw gateway, and
uses Tavily (primary) with DuckDuckGo (fallback) for web search.
Capabilities include tool use, human-in-the-loop (HITL), guarded patch
application, and structured logging.

## Quality System (LIVE since S6-S7)

The quality system was adopted in sessions S6-S7, driven from the meta repo
`self-maintaining-system`. All of the following are LIVE in this repo:

- `./verify` shim + vendored pinned runner (`tools/verify-runner.mjs`, pin
  record `tools/RUNNER_SOURCE.json`, dev-standards tag `v0.0.2`).
- `quality.json` manifest with `staged` / `fast` / `full` tiers; the
  `architecture` check is dependency-cruiser (ADR-001) and `dead-code` is knip
  in report-only mode (ADR-002). Schema: `schemas/quality.schema.json`.
- Pinned gitleaks wrapper (`tools/run-gitleaks` + `tools/TOOL_VERSIONS.json`,
  gitleaks 8.30.1) with a custom `.gitleaks.toml`.
- Native hooks (`core.hooksPath -> .githooks`): pre-commit/pre-push run
  `./verify` (see Verification Surface). Prettier baseline done.

CI is live (S7 Task 10): `.github/workflows/quality.yml` runs `./verify --fast`
on PRs (read-only token) and `./verify --full` on push-to-main + the weekly
schedule, with a separate `issues: write` report job that upserts a single
red-main tracking issue on failure and closes it on recovery. Validated by two
green real pushes to main (2026-06-10).

## Canonical Files

- `AGENTS.md` / `CLAUDE.md` - thin routers into `.agents/`.
- `package.json` - npm scripts, deps, and `engines` Node range.
- `tsconfig.json` - TypeScript compiler config (`outDir: dist`).
- `eslint.config.js` - flat ESLint config incl. the local `block-comments-only`
  rule and the advisory `eslint-plugin-boundaries` layer mirror (ADR-001).
- `.prettierrc.json` / `.prettierignore` / `.editorconfig` - formatting.
- `.dependency-cruiser.cjs` - authoritative layer-DAG enforcement (ADR-001).
- `knip.json` - dead-code config (ADR-002).
- `quality.json` / `schemas/quality.schema.json` - the `./verify` manifest.
- `.gitleaks.toml` - secret-scan rules and allowlist.
- `openclaw.config.json5` - OpenClaw gateway, agents, plugins, tools config;
  references the gateway token only via `${OPENCLAW_GATEWAY_TOKEN}` env
  substitution (no literals).
- `src/main.ts` / `src/index.ts` - entrypoints.

## Sensitive Paths

Changes here should trigger at least a lightweight review:

- `.github/workflows/**`
- `.githooks/**`
- `verify`, `tools/**` (the skill-owned quality tooling; NOT `src/tools/`,
  which is application code)
- `quality.json`, `schemas/**`
- `openclaw.config.json5` and `openclaw.config.json5.last-good`
- `.env*`
- `scripts/run-task.sh`

## Gateway Token Handling (env-only, fail-loud)

The gateway token is read env-only via `getGatewayToken()` in
`src/tools/gateway.ts` (`process.env[EnvVar.GATEWAY_TOKEN]`), which throws when
unset. The former `DEFAULT_GATEWAY_TOKEN` fallback in `src/consts/openclaw.ts`
was DELETED in S6 and the live config now substitutes the token from the
environment (`${OPENCLAW_GATEWAY_TOKEN}`); the previously committed literal was
rotated and is worthless. No token literal lives in source or config.

## No-Touch Zones

These paths must never be edited autonomously by a deep review/refactor pass;
findings here are emitted as a plan, not a fix. This list extends the
skill-owned baseline (`.githooks/`, `.github/workflows/`, `./verify`, `tools/`,
`auth/**`, `credentials/**`) and cannot shrink it. Repo-specific additions:

- `openclaw.config.json5` (and `openclaw.config.json5.last-good`)
- `.env*`

## Generated Or Transient Paths

- `dist/` - TypeScript build output (`tsconfig` `outDir`); gitignored.
- `.codegraph/` - local CodeGraph index; gitignored.
- `.openclaw_state/` - OpenClaw runtime state; gitignored.
- `reports/quality/` - quality-runner output; gitignored.

## Known False Positives

Accepted tool/review false positives live in
[known-false-positives.md](known-false-positives.md). Reviewers must not
re-report them: the depcruise `no-orphans` warnings on two type-only modules,
the gitleaks burned `dev_token_123`, and the knip `openclaw` unused-dependency
finding.

## Verification Surface

- `./verify --staged` - pre-commit scope (staged files).
- `./verify --fast` - pre-push scope; includes the depcruise architecture gate.
- `./verify --full` - full scope; adds knip dead-code (report-only).
- `./verify --doctor` - environment/toolchain self-check.
- `npm test` - the legacy chain `npm run typecheck && npm run lint && npm run smoke`,
  where `smoke` runs the six smoke scripts (`smoke:react`, `smoke:patch`,
  `smoke:hitl`, `smoke:websearch`, `smoke:verify-report`, `smoke:logging`);
  `typecheck` is `tsc --noEmit`, `lint` is `eslint .`.

## Layer Facts

The `src/` layer DAG is DECIDED (owner decision D3, session S5) and recorded in
[architecture-decisions.md](architecture-decisions.md) ADR-001 (8 bands L0-L7,
the only allowed intra-band edge being `graph -> swarm`). Do not duplicate the
table here; ADR-001 is authoritative and is mirrored in `.dependency-cruiser.cjs`
(the gate) and `eslint.config.js` (advisory).
