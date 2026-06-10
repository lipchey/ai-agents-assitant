# Automated Cross-Runtime Review Chain (R-sessions)

How every `R<n>` session runs its own review at the session boundary, with
no owner step in the loop. Seats per [model-roles.md](model-roles.md):
Fable 5 produces, Codex (GPT 5.5) reviews, an Opus 4.8 subagent fixes.
Adapted from the meta-repo's ADR-011 chain; the command below resolves the
repo root with `git rev-parse` so it stays path-relative.

## Form: in-session orchestration

The main Fable session drives all three legs inside one trust boundary: it
runs Codex headlessly via Bash and dispatches the Opus subagent via the
Agent tool. No `--dangerously-skip-permissions`, no `danger-full-access`.

## Legs

1. **Review (Codex, reviewer seat).** Write a brief to
   `/tmp/claude/<slug>/codex-task.md` (slug = `r<n>-<short-topic>`), then:

   ```bash
   repo_root="$(git rev-parse --show-toplevel)"
   CODEX_HOME="$HOME/.codex" /Applications/Codex.app/Contents/Resources/codex exec \
     -C "${repo_root}" -s workspace-write \
     --add-dir /tmp/claude/<slug> \
     --output-last-message /tmp/claude/<slug>/codex-last.md \
     - < /tmp/claude/<slug>/codex-task.md
   ```

   The brief MUST state:
   - scope: the session diff range (`git diff <baseline_sha>..HEAD`);
   - read-first context: `.agents/project-facts.md` (sensitive paths),
     the plan task `R<n>` in
     `docs/superpowers/plans/2026-06-10-boilerplate-refactor.md`, and spec
     §3 contracts in
     `docs/superpowers/specs/2026-06-10-boilerplate-refactor-design.md`;
   - known/accepted findings NOT to re-report (from `.agents/tasks.md`
     backlog and `.agents/known-false-positives.md` if present);
   - the P1/P2/P3 severity scale (P1 likely-broken behavior or security;
     P2 concrete correctness/maintainability gap; P3 polish);
   - the actual deterministic boundary that ran (`./verify --fast` since S6, or
     stronger if `--full` was run) is already green — name that scope so the
     reviewer judges what it cannot prove; `npm test` is only the legacy/fallback
     surface and understates the gates (depcruise arch, gitleaks scan) that
     `./verify --fast` adds;
   - instruction to write findings to `/tmp/claude/<slug>/codex-findings.md`.

2. **Verify + fix (Opus subagent, fixer seat).** Dispatch one subagent
   (`Agent` tool, `model: "opus"`) that: reads the findings; verifies each
   against the actual code (reproduce or trace; classify
   confirmed / refuted / needs-owner-decision); implements **confirmed
   P1/P2 only**, with tests where practical. Guardrails: never change the
   frozen contracts (spec §3.2 Profile schema, §3.3 ChatProvider, §3.4
   RunSummary once landed; pinned commit messages; `.agents/project-facts.md`
   no-touch zones — `.env*`, `openclaw.config.json5*`, CI workflows). If a
   fix needs a frozen-contract change, classify it `needs-owner-decision`
   and record it. Re-run the session boundary (`./verify --fast`, or stronger
   if the session ran it; `npm test` is the legacy fallback); **revert any fix
   that cannot go green** (no red commit). Commit each accepted fix; write
   `/tmp/claude/<slug>/opus-result.md`.

3. **Re-review (Codex).** Headless re-review of the **fix delta only**
   (`git diff <pre-fix-head>..HEAD`): each finding CLOSED / NOT-CLOSED
   (with reproduction) / CLOSED-BUT-NEW-ISSUE.

## Stop conditions

- Confirmed-but-frozen-contract findings, all P3s, and anything still open
  after the loop cap (one fix pass + one re-review) go to `.agents/tasks.md`
  backlog as `needs-human`, never auto-applied.
- Handoff files under `/tmp/claude/<slug>/` are disposable; the durable
  record is the commits + the session report + backlog entries.
