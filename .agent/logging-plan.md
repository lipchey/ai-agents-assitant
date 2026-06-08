# Structured Logging — Implementation Plan

Plan for the open backlog item "Add structured logging" in
[memory.md](memory.md) and [tasks.md](tasks.md). Written for review (Codex)
before implementation. Conforms to [code-guidelines.md](code-guidelines.md) and
[guidelines.md](guidelines.md).

---

## 1. Goal & success criteria

**Goal.** Consolidate all logging behind one `Logger` abstraction so the output
target (console, JSON stream, file, remote, in-memory buffer) can be swapped in
**one place** without touching call sites.

**Done when:**

1. No `console.*` calls remain in `src/**` (scripts handled in an optional final
   phase — see §8).
2. All diagnostics flow through a leveled `Logger`; user-facing output flows
   through one swappable writer.
3. Output target is changed by swapping a single `LogSink` (and/or stream) via
   `configureLogging(...)` — no call-site edits required.
4. The empty-DuckDuckGo-fallback warning (the concrete backlog driver) is emitted
   through the new logger.
5. `npm run typecheck` + all smoke tests pass, including a new `smoke:logging`.

**Non-goals (this iteration):** log rotation, async/batched transports, a remote
sink implementation, OpenTelemetry, redaction/PII filtering. The `LogSink` seam
must make these trivial to add later, but we ship only console/JSON/buffer sinks.

---

## 2. Current state inventory

| Location | Calls | Nature | Target channel after migration |
| --- | --- | --- | --- |
| [src/main.ts](../src/main.ts) | 6 | Lifecycle (`gateway starting/ready`, `patch enabled`) + fatal errors + usage | `logger.info` / `logger.error` |
| [src/cli/report.ts](../src/cli/report.ts) | 12 | Final answer + patch + telemetry report | **User-output channel** (plain, unfiltered) |
| [src/hitl/resolvers.ts](../src/hitl/resolvers.ts) | 6 | Interactive TTY prompt header before `rl.question` | **User-output channel** (TTY-bound) |
| [src/tools/web-search.ts](../src/tools/web-search.ts) | 0 (gap) | Empty fallback result is silently returned | **add** `logger.warn` |
| `scripts/*-smoke.ts` | ~25 | Dev harness output | Optional (Phase 4) |

Key observation: not all current output is "logging". Two distinct concerns:

- **Diagnostics** — severity-ranked, contextual, may be filtered/suppressed,
  may carry structured fields. (gateway lifecycle, errors, the new warn).
- **User-facing output** — the final report and the HITL prompt. Must always
  appear (never filtered by log level), must stay clean (no timestamp/level
  prefixes), and HITL is coupled to the interactive TTY `readline`.

The design keeps these as two channels over **one transport** so "change the
output" is still a single edit, but the report never gets polluted with log
metadata and never disappears when the level is raised.

---

## 3. Design overview — two channels, one transport

```
 call sites                channels                  transport (swappable)
 ----------                --------                  ---------------------
 logger.info/warn/...  ->  Logger ----\
                                       >--- LogSink.write(LogRecord) ---> stream/console/json/buffer
 printReport / HITL    ->  OutputWriter (plain lines) ----------------/   (shared underlying target)
```

- **`Logger`** — leveled (`debug/info/warn/error`), threshold-filtered, supports
  bound context via `child(context)`. Emits a structured `LogRecord` to a
  `LogSink`.
- **`LogSink`** — the single pluggable transport (`write(record): void`). This is
  the seam that satisfies the goal. Default `StreamSink` formats a record (text
  or JSON) and writes to `process.stdout` (debug/info) or `process.stderr`
  (warn/error).
- **`OutputWriter`** — plain user-facing lines for the report and HITL prompt;
  never level-filtered, no metadata. Defaults to the same stdout stream the
  `StreamSink` uses, so one `configureLogging` call retargets both.
- **Root module** wires level/format/sink/stream from env once and hands out the
  root `Logger`, child loggers, and the `OutputWriter`.

Rationale for two channels (vs. routing the report through `info`): the report is
primary program output, not a diagnostic. Collapsing it into `info` would (a)
prefix every report line with `timestamp INFO`, (b) hide the report whenever
`AGENT_LOG_LEVEL=warn`, and (c) split a single multi-line report into N records.
Recorded as an open decision in §10.

---

## 4. Module layout

New subsystem `src/logging/` (impl) + contracts in `src/types/logging.ts`,
following the existing `hitl/` + `types/hitl` precedent. Cohesive files, one job
each, named-export barrel; internal files import each other by concrete `.ts`
path, never the barrel (cycle safety).

```
src/logging/
  logger.ts        createLogger(): Logger impl — level filter + child context merge
  stream-sink.ts   StreamSink: format + route to stdout/stderr
  formatters.ts    textFormatter, jsonFormatter (LogFormatter)
  output.ts        OutputWriter (plain user-facing lines)
  root.ts          env-driven init; getLogger/configureLogging/getOutputWriter; setSink (tests)
  index.ts         barrel: createLogger, getLogger, configureLogging, getOutputWriter, StreamSink, formatters

src/types/logging.ts   Logger, LogRecord, LogFields, LogSink, LogFormatter,
                       LoggerOptions, OutputWriter  (re-exported via src/types/index.ts)

src/consts/logging.ts  LogLevel, LogFormat, LOG_LEVEL_RANK, DEFAULT_LOG_LEVEL,
                       DEFAULT_LOG_FORMAT  (re-exported via src/consts/index.ts)
```

Public surface: add `getLogger`, `configureLogging`, `createLogger`, `LogLevel`
and the `Logger`/`LogSink` types to the root barrel [src/index.ts](../src/index.ts)
(logging is legitimately public API). `src/main.ts` stays CLI-only.

---

## 5. Constants & env

**`src/consts/logging.ts`** (closed `as const` + same-named union, per §1 of
code-guidelines):

```ts
export const LogLevel = {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const LogFormat = { TEXT: "text", JSON: "json" } as const;
export type LogFormat = (typeof LogFormat)[keyof typeof LogFormat];

/* Severity ordering for threshold filtering; a record emits when its rank >= the configured level rank. */
export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 10,
    [LogLevel.INFO]: 20,
    [LogLevel.WARN]: 30,
    [LogLevel.ERROR]: 40,
};

export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.INFO;
export const DEFAULT_LOG_FORMAT: LogFormat = LogFormat.TEXT;
```

**`src/consts/env.ts`** — add two `EnvVar` entries (and update `.env.example`):

```ts
LOG_LEVEL: "AGENT_LOG_LEVEL",     // debug | info | warn | error  (default info)
LOG_FORMAT: "AGENT_LOG_FORMAT",   // text | json                  (default text)
```

Env parsing lives in `src/logging/root.ts` (logging is cross-cutting and must not
depend on `src/cli/`). An unrecognized value falls back to the default and emits
one `warn` through the freshly built logger.

---

## 6. Public contracts (sketch)

**`src/types/logging.ts`:**

```ts
import type { LogLevel } from "../consts/logging.ts";

export type LogFields = Record<string, unknown>;

export interface LogRecord {
    level: LogLevel;
    message: string;
    time: Date;
    context?: LogFields; // bound child context
    fields?: LogFields;  // per-call fields; an `error` key is rendered via shared/text helpers
}

export interface LogSink {
    write(record: LogRecord): void;
}

export type LogFormatter = (record: LogRecord) => string;

export interface Logger {
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
    child(context: LogFields): Logger;
}

export interface OutputWriter {
    line(text: string): void; // user-facing, unformatted, never level-filtered
}

export interface LoggerOptions {
    level?: LogLevel;
    sink?: LogSink;
    context?: LogFields;
}
```

Notes for the implementer:

- `child(context)` returns a new `Logger` whose context is the parent context
  merged with the child's; per-call `fields` win over `context` on key clash.
- Errors: callers pass `logger.error("msg", { error })`. The text formatter
  renders the `error` field with `stringifyError`/`errorMessage` from
  [src/shared/text.ts](../src/shared/text.ts) — **do not** hand-roll error
  coercion (no-duplication rule). The JSON formatter serializes via the existing
  `safeJson`/`stringifyPretty` helpers.
- `StreamSink` routes by rank: `>= WARN` to `process.stderr`, else
  `process.stdout`.
- Format selection (`textFormatter` vs `jsonFormatter`) is an exhaustive switch
  over `LogFormat` terminated by an `assertNever` branch (TS §4 rule).
- The root keeps a module-level singleton built lazily from env;
  `configureLogging({ level?, format?, sink?, stream? })` rebuilds it (used by
  embedders); `setSink(sink)` / reset helpers exist for tests.

**Text format example:** `2026-06-08T12:00:00.000Z INFO [module=web-search] web_lookup fallback returned no results query="..."`

---

## 7. Migration map

| File | Current | After |
| --- | --- | --- |
| [main.ts](../src/main.ts):10 | `console.error('Usage: ...')` | `logger.error("Usage: npm start -- \"<task>\"")` |
| main.ts:17,21,32 | `console.log(...)` lifecycle | `logger.info(...)` |
| main.ts:23,48 | `console.error("...", err)` | `logger.error("...", { error })` |
| [cli/report.ts](../src/cli/report.ts) | 12× `console.log` | `output.line(...)` (OutputWriter); formatting unchanged |
| [hitl/resolvers.ts](../src/hitl/resolvers.ts):18-23 | 6× `console.log` prompt header | `output.line(...)`; `rl.question` stays on `process.stdout` (TTY-bound) |
| [tools/web-search.ts](../src/tools/web-search.ts) | silent empty fallback | `child({ module: "web-search" }).warn("fallback returned no results", { query, tavilyFailure })` when `webSearchResultIsEmpty(fallback)` |

HITL constraint: the interactive prompt must reach the operator's terminal and
stay adjacent to the `readline` question, so it uses the `OutputWriter` but the
default writer must remain the TTY stdout when `process.stdin.isTTY`. Document
that redirecting output to a non-TTY sink does not redirect the `readline`
question itself.

---

## 8. Phasing (each phase is independently green: `typecheck` + smoke)

- **Phase 0 — scaffolding (no behavior change):** add `consts/logging.ts`,
  `types/logging.ts`, the two `EnvVar` entries, `.env.example`; wire the consts
  and types barrels.
- **Phase 1 — core logger:** `logger.ts`, `stream-sink.ts`, `formatters.ts`,
  `output.ts`, `root.ts`, `logging/index.ts`; export from root barrel; add
  `scripts/logging-smoke.ts` + `smoke:logging`. No call-site migration yet.
- **Phase 2 — migrate diagnostics + user output:** `main.ts`, `cli/report.ts`,
  `hitl/resolvers.ts` per §7.
- **Phase 3 — close the backlog driver:** `web-search.ts` empty-fallback warn;
  sweep for other silently swallowed warnings worth surfacing.
- **Phase 4 — optional:** migrate `scripts/*-smoke.ts` to the logger/output for
  full consistency, or consciously leave them on `console.*` as a dev harness.

---

## 9. Testing

No unit framework in repo — follow the smoke-test discipline. Add
`scripts/logging-smoke.ts` driven by an in-memory `BufferSink` (itself proof the
`LogSink` seam is pluggable) asserting:

1. Threshold filtering: at `WARN`, `debug`/`info` are dropped, `warn`/`error` pass.
2. `child(context)` merges context; per-call `fields` override on key clash.
3. `textFormatter` includes level + context; `jsonFormatter` emits one parseable
   JSON object per record.
4. `StreamSink` routes `>= WARN` to stderr, else stdout.
5. `error` field is rendered via shared helpers (Error → message, not `[object]`).

Wire `smoke:logging` into the `smoke` aggregate and `test` script. Because
[code-guidelines.md](code-guidelines.md) hard-codes the four-smoke list and the
five-smoke pre-commit gate, **update that line** plus [memory.md](memory.md) §6
when the fifth smoke lands.

---

## 10. Open decisions for review

1. **Report channel.** Recommended: keep the report on a separate plain
   `OutputWriter` (never filtered, no metadata). Alternative: route it through
   `logger.info`. Recommendation: separate channel (see §3 rationale).
2. **Singleton vs. DI.** The project DIs the tool registry/HITL resolver via
   graph config. Logging is more cross-cutting; recommended: env-configured root
   singleton + `child()`, with `configureLogging`/`setSink` for tests/embedders.
   Alternative: thread a `Logger` through call sites (heavier, more churn).
3. **Scripts migration.** Recommended: optional Phase 4; default-leave smoke
   scripts on `console.*` unless we want zero `console.*` repo-wide.
4. **JSON timestamp shape.** `Date.toISOString()` string vs epoch ms — pick one;
   recommended ISO string for human + machine readability.

---

## 11. Compliance checklist (for reviewer)

- [ ] Levels/format are `as const` + same-named union in `src/consts/logging.ts`;
      no magic level strings at call sites.
- [ ] New `EnvVar`s added and `.env.example` updated (every read env var listed).
- [ ] Contracts in `src/types/logging.ts`; impl in `src/logging/`; root reserved
      to `main.ts`/`index.ts`.
- [ ] Folder barrel with explicit named exports; internal files import concrete
      `.ts`; barrel not imported by a file it re-exports.
- [ ] Reuses `shared/text.ts` for error/JSON coercion — no new stringify helper.
- [ ] Format/level switches exhaustive via `assertNever`; `import type` for
      type-only imports; tsconfig strictness stays green.
- [ ] Block comments only, why-not-what; no `//`, no banners.
- [ ] `typecheck` + all smokes (incl. `smoke:logging`) pass; `memory.md` and
      `tasks.md` updated on completion.

---

## 12. Codex critical review findings (2026-06-08)

Reviewer status: **revise before implementation**. The plan is directionally
sound, especially the split between diagnostics and user-facing output, but the
items below should be folded into the implementation plan before code changes.

### P0 - Single transport goal is underspecified

The plan says the output target can be changed by swapping one `LogSink`, but
`LogSink.write(record)` can only carry structured diagnostic records. The
`OutputWriter` bypasses that interface, so replacing the sink alone would not
move the final report or HITL prompt.

Required amendment:

- Define the single swappable runtime boundary explicitly. Either introduce a
  transport interface with both `writeRecord(record)` and `writePlain(text,
  channel)` methods, or define `configureLogging({ sink, output })` as the one
  supported reconfiguration point.
- Update the done criteria from "swap one `LogSink`" to "change diagnostics and
  user output in one `configureLogging(...)` call."
- Add a smoke assertion that a custom configured target receives both a
  diagnostic log and a user-output line.

### P0 - Default diagnostic stream can still pollute primary output

`StreamSink` currently plans to write debug/info diagnostics to stdout and
warn/error to stderr, while the final report also writes to stdout. That keeps
report lines unformatted, but it does not keep stdout clean for callers that
consume the agent's primary answer/report.

Required amendment:

- Prefer routing **all diagnostics to stderr by default** and reserving stdout
  for `OutputWriter` user output.
- If stdout info logs are intentionally kept, document that stdout is mixed
  output and add a config option with separate `diagnosticStdout`,
  `diagnosticStderr`, and `userStdout` streams.
- Decide where CLI usage errors belong. `Usage: npm start ...` is user-facing
  error output, not ordinary telemetry; it should likely use a plain stderr
  writer rather than `logger.error` when `AGENT_LOG_FORMAT=json`.

### P0 - OutputWriter contract is too narrow

`OutputWriter.line(text)` is enough for the happy-path final report, but not for
all current user-facing output:

- CLI usage and fatal user-visible failures should be able to write plain stderr.
- HITL uses `readline` on `process.stdout`; redirecting `OutputWriter` does not
  redirect the actual question prompt.
- Multi-line reports would be cleaner and less interleavable as one block write.

Required amendment:

- Extend the contract to something like `write(text)`, `line(text)`,
  `errorLine(text)`, and optionally `blankLine()`, or explicitly keep separate
  `stdout` and `stderr` plain writers.
- Document that HITL header output is configurable, but `rl.question(...)`
  remains bound to the TTY streams unless `createStdinHitlResolver` receives
  custom `input`/`output` streams.

### P1 - Bootstrapping, singleton, and env warnings need sharper rules

The lazy root singleton is reasonable, but config-time warnings can be tricky:
invalid env values are detected while the logger is being built, and warnings
can be filtered if the configured level is `error`.

Required amendment:

- Parse env into a plain config object first, collect config warnings, create the
  logger, assign the singleton, then emit warnings.
- Config warnings should bypass only invalid config, not recurse through another
  config read.
- Document precedence: `configureLogging(...)` called before first `getLogger()`
  wins over env; calling it after first use replaces the singleton for future
  calls only.
- `src/main.ts` imports `dotenv/config`, but library consumers do not. Keep this
  behavior explicit: logging reads `process.env`, it does not load dotenv.

### P1 - Sink failures and serialization failures must not crash the agent

Logging should never become a new failure mode for graph execution, HITL, patch
rollback, or provider cleanup.

Required amendment:

- `Logger` should catch `LogSink.write` failures and either drop the record or
  write one best-effort fallback line to stderr.
- Formatters must tolerate circular objects, `BigInt`, `Error`, and unknown
  values. Existing `safeJson` is useful but not sufficient by itself for a JSON
  formatter that promises one parseable object per line.
- Define a small log-field normalization rule. `error` fields should become a
  message plus optional name/stack in JSON, not `{}` or `[object Object]`.

### P1 - Data safety is marked non-goal, but minimum logging hygiene is still needed

Full redaction can stay out of scope, but the plan currently proposes logging
the full web query at warn level and leaves future file/remote sinks open. This
can persist user task text, search terms, provider errors, or tool observations.

Required amendment:

- Add a "minimum hygiene" rule: never log env maps, auth headers, API keys,
  full patch contents, full tool observations, or raw LLM prompts/responses.
- Truncate high-cardinality strings in fields, including `query`,
  `originalTask`, provider errors, and path lists.
- For the DuckDuckGo empty-result warning, consider fields like
  `{ provider, fallbackProvider, tavilyFallbackReason, queryPreview }` instead
  of the full raw query.

### P1 - `LogRecord` shape has contradictory merge semantics

The type sketch stores `context` and `fields` separately, but the notes say
per-call fields win over context on key clash. If JSON output keeps both objects,
there is no actual key clash. If text output merges them, JSON and text records
have different semantics.

Required amendment:

- Pick one shape:
  - keep `context` and `fields` separate everywhere, with no override semantics;
  - or store one normalized `fields` object in `LogRecord` after parent/child
    context and per-call fields are merged.
- Add a deterministic key ordering rule for text formatting so smoke assertions
  do not depend on object insertion quirks.

### P1 - Buffer sink is referenced but not placed

The non-goals say ship console/JSON/buffer sinks, and testing depends on a
`BufferSink`, but the module layout does not include one.

Required amendment:

- Add `buffer-sink.ts` to `src/logging/` if it is public/product code.
- If it is test-only, keep it inside `scripts/logging-smoke.ts` and remove
  "buffer sinks" from the shipped scope.

### P1 - Public API should not expose test-only mutators casually

The plan mentions `setSink(sink)` and reset helpers. Exporting those through the
root barrel would make test-only global mutation part of the public API.

Required amendment:

- Prefer `configureLogging(...)` for embedders and tests.
- If reset helpers are needed, keep them named as test utilities and do not
  export them from `src/index.ts` unless intentionally supported.

### P1 - Web-search warning needs a direct regression test

`smoke:logging` proves the logger works, but it does not prove the backlog
driver is closed.

Required amendment:

- Extend `scripts/websearch-smoke.ts` with a case where Tavily is empty or
  failing and DuckDuckGo fallback also returns an empty payload.
- Configure an in-memory logging target in that smoke and assert exactly one
  warning is emitted while the tool still returns successfully.
- Keep the existing both-backends-down case separate; provider-unavailable
  should still throw a structured `ToolError`.

### P2 - Current inventory is slightly stale

The inventory is close but not exact. Current `rg` output shows:

- `src/main.ts`: 6 `console.*` calls.
- `src/cli/report.ts`: 12 `console.log` calls.
- `src/hitl/resolvers.ts`: 6 `console.log` calls.
- `scripts/hitl-smoke.ts`, `scripts/react-smoke.ts`,
  `scripts/gateway-smoke.ts`, `scripts/patch-smoke.ts`, and
  `scripts/websearch-smoke.ts` all use `console.*`.
- `scripts/gateway-smoke.ts` exists but is not currently in the `smoke`
  aggregate in `package.json`.

Required amendment:

- Update §2 to list `gateway-smoke.ts` explicitly and avoid the approximate
  `~25` count unless refreshed during implementation.
- Add a final verification command to the checklist:
  `rg -n "console\\." src` should return no matches after Phase 2.

### P2 - `configureLogging(...)` type sketch is incomplete

§6 sketches only `LoggerOptions`, but §3 and §6 also mention configuring
format, sink, and stream.

Required amendment:

- Add a separate `LoggingConfig` or `ConfigureLoggingOptions` type that covers
  level, format, diagnostic sink/formatter, stdout/stderr streams, and
  plain-output writer.
- Keep `LoggerOptions` limited to the lower-level `createLogger(...)` factory.

### P2 - Plan should name the migration signatures

Call-site migration will be easier and safer if the new function signatures are
settled before implementation.

Required amendment:

- `printReport(finalState, costBudgetUsd, output = getOutputWriter())`.
- `createStdinHitlResolver(options?: { output?: OutputWriter; input?: NodeJS.ReadableStream; questionOutput?: NodeJS.WritableStream })`.
- `runWebLookupWithFallback(...)` can use `getLogger().child(...)` as planned,
  but tests must configure the root logger before invoking `openclawRpc(...)`.

### P2 - Documentation updates should include `.env.example` and guidelines

The plan already mentions these, but the exact files should be explicit:

- `.env.example`: add `AGENT_LOG_LEVEL` and `AGENT_LOG_FORMAT`.
- `.agent/code-guidelines.md`: update the hard-coded smoke list from four to
  five once `smoke:logging` lands.
- `.agent/memory.md`: update the structured-logging backlog note after
  implementation, not during this review-only pass.
