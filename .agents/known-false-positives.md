# Known False Positives

Durable false positives from deterministic tools or advisory reviews. Reviewers
and the cross-runtime review chain must NOT re-report these. Each entry routes
to its decision record rather than duplicating rationale; update it when a
finding is newly accepted as noise or when an accepted item is resolved.

Each entry: tool, finding, affected path, why accepted (with a pointer), date,
and when to revisit.

## 1. dependency-cruiser `no-orphans` on two type-only leaf modules

- **Tool:** dependency-cruiser (`npm run arch`, `architecture` check, warn).
- **Finding:** `no-orphans` warns on `src/types/state/graph.ts` and
  `src/types/state/swarm.ts`.
- **Why accepted:** these leaf type modules are reachable only through the
  type-only re-export barrel `src/types/state/index.ts`, an edge depcruise's
  `tsPreCompilationDeps` tracing misses. They are genuinely used (typecheck is
  green). Full rationale in `architecture-decisions.md` ADR-001 "Known false
  positives". Do not delete.
- **Date accepted:** 2026-06-10 (Gate 0a / S5).
- **When to revisit:** if `no-orphans` is promoted from warn to error, exempt
  these two paths with a dated note in ADR-001.

## 2. gitleaks burned dev token `dev_token_123`

- **Tool:** gitleaks (`tools/run-gitleaks`, pinned 8.30.1).
- **Finding:** historical literal `dev_token_123` in git history.
- **Why accepted:** suppressed via a rule-scoped exact-secret allowlist in
  `.gitleaks.toml` (S6). The literal is rotated and worthless. See the S6
  section of `tasks.md` and the `.gitleaks.toml` allowlist comment.
- **Date accepted:** 2026-06-10 (S6).
- **When to revisit:** never re-add the literal; if the allowlist rule is
  widened, re-scope it to this exact secret only.

## 3. knip flags `openclaw` as an unused dependency

- **Tool:** knip (`dead-code` check, report-only).
- **Finding:** `openclaw` reported as an unused dependency.
- **Why accepted (keep):** `openclaw` ships the gateway CLI binary, invoked
  outside npm scripts, so knip's import graph cannot see it. Owner-routed:
  keep it as a baseline finding, do NOT remove. Full rationale in
  `architecture-decisions.md` ADR-002 ("No dependency ignores").
- **Date accepted:** 2026-06-10 (S7, Task 8).
- **When to revisit:** if the gateway CLI is ever invoked via an npm script or
  a direct import, this becomes a true finding and the entry is dropped.
