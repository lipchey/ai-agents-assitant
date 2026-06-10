# Security Review Guide

Repo-local guide for a security review of `ai-agents-assitant`. The threat
surface is a multi-agent service that holds provider tokens, talks to a local
OpenClaw gateway that can execute commands, applies model-authored patches to
the filesystem, and fetches arbitrary URLs for web research. Loaded by explicit
instruction. Keep findings actionable.

## First rule: do not re-report deterministic findings

`gitleaks` (pinned 8.30.1, custom `.gitleaks.toml`) scans for secrets on every
staged commit via the hook; `eslint`/`tsc` run too. NEVER re-report a secret
gitleaks already catches or an accepted entry in `known-false-positives.md`
(e.g. the burned `dev_token_123`). Judge the handling, scoping, and trust
assumptions the scanners cannot.

## Output format

- `P1` - exploitable or likely-broken security behavior (token leak, sandbox
  escape, path traversal, SSRF) that the gates do not catch.
- `P2` - concrete weakening of a guard or a missing defense-in-depth layer.
- `P3` - hardening / clarity improvement.

Each finding: file path + line, the concrete attack or failure it enables, and
a suggested fix. No prose dumps.

## Checklist

### Gateway token: env-only, no literals, fail-loud

- The gateway token is read env-only via `getGatewayToken()` in
  `src/tools/gateway.ts` (`process.env[EnvVar.GATEWAY_TOKEN]`), which throws
  loudly when unset. The `DEFAULT_GATEWAY_TOKEN` fallback was deleted in S6;
  `openclaw.config.json5` references the token only via
  `${OPENCLAW_GATEWAY_TOKEN}` substitution. Flag ANY reintroduction of: a token
  literal in source or config, a silent default/fallback, or a token read from
  anywhere but the environment.
- Flag a token value reaching a log line, an error message body, a thrown
  payload, or an artifact. Auth headers (`authHeaders()`) must never be logged.

### OpenClaw gateway-hosted exec surface (loopback-only assumption)

- The gateway base URL defaults to `http://127.0.0.1:18789` and the design
  assumes a loopback-only, locally-controlled gateway. Flag any change that
  points the gateway at a non-loopback or attacker-influenced host, accepts the
  gateway URL from untrusted input, or weakens that assumption without an
  explicit decision.
- The gateway can execute commands on behalf of the agent. The only shell
  allowlist is `SAFE_DIRECT_EXEC_COMMANDS`; local providers enforce no shell
  interpolation and a workspace path bound. Flag any new exec path that bypasses
  the allowlist, interpolates model/user text into a command, or routes exec
  outside the local provider guards.
- Flag any path where fetched web content, read file content, or worker/model
  output reaches a privileged action (patch target or content, exec command,
  outbound request) without being treated as untrusted data (prompt injection
  via tool results).

### Patch-apply filesystem writes (`src/patching`)

- `applyPatchBlocks()` resolves every target through `resolveWorkspacePath()`,
  refuses workspace escapes, and refuses `PROTECTED_SEGMENTS` (`.git`,
  `node_modules`) via `isProtectedPath()`. Flag any write that skips
  `resolveWorkspacePath`, any path-traversal vector (`../`, absolute paths,
  symlinks) that could escape the workspace, or any shrinking of the protected
  set.
- Patch application is opt-in (`AGENT_APPLY_PATCHES`) and snapshots pristine
  files for rollback. Flag a change that writes before guards pass, loses the
  pristine snapshot, or leaves created files on a failed verify (finalize must
  restore/clean up).

### Web-tool SSRF / input handling (`src/tools/providers/web`, `web-search.ts`)

- `web_lookup` carries the `external_network` capability and runs Tavily then a
  DuckDuckGo fallback. The query is model-authored. Flag any path that lets the
  query or args control the request TARGET (host/URL/port) rather than just the
  search term, i.e. a path turning a search call into SSRF against the loopback
  gateway or internal services.
- Flag unbounded responses fed back into prompts without truncation, or
  fallback errors that leak internal endpoint details.

### `.env*` hygiene

- `.env` holds the rotated gateway token and the four provider keys; it is
  untracked. Flag: any `.env*` file becoming tracked, a real key landing in
  `.env.example`, a token printed to stdout/stderr, or a loosened file mode.
  `.env.example` must list every `EnvVar` the app reads with placeholders only.

### No-touch zones

- `project-facts.md` lists no-touch paths (`.env*`, `openclaw.config.json5*`,
  CI workflows, `.githooks/`, `./verify`, `tools/`). A security FIX that needs
  to change one of these is a finding to route to the owner, not an
  auto-applied edit.
