/* Bench runner (plan R7.4): wraps `promptfoo eval` so every run lands in a
   fresh reports/bench/<timestamp>/ directory with machine-readable
   results.json plus a generated summary.md table. Invoked via `npm run bench`;
   extra CLI args pass through to promptfoo eval (`--filter <regex>` is a
   friendly alias for promptfoo's `--filter-pattern`). */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--offline")) {
    /* The offline suite needs the deterministic fake ChatProvider, which lands
       in R8 — see .agents/tasks.md § Backlog. */
    console.error("bench --offline is not available yet: it needs the R8 fake provider. Run the live suite instead.");
    process.exit(1);
}

const passthrough = args.map((arg) => (arg === "--filter" ? "--filter-pattern" : arg));

const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/gu, "-")
    .replace(/-\d{3}Z$/u, "Z");
const outDir = path.join("reports", "bench", timestamp);
mkdirSync(outDir, { recursive: true });
const resultsPath = path.join(outDir, "results.json");

const evalArgs = [
    "eval",
    "--config",
    "bench/promptfooconfig.yaml",
    "--output",
    resultsPath,
    "--max-concurrency",
    "1",
    "--no-cache",
    "--no-progress-bar",
    ...passthrough,
];

console.log(`[bench] promptfoo eval -> ${outDir}`);
const run = spawnSync(path.resolve("node_modules/.bin/promptfoo"), evalArgs, {
    stdio: "inherit",
    env: {
        ...process.env,
        PROMPTFOO_DISABLE_TELEMETRY: process.env.PROMPTFOO_DISABLE_TELEMETRY ?? "1",
        /* Keep agent diagnostics from drowning the eval progress output. */
        AGENT_LOG_LEVEL: process.env.AGENT_LOG_LEVEL ?? "warn",
    },
});

const formatUsd = (value) => `$${value.toFixed(6)}`;
const formatSeconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

try {
    const parsed = JSON.parse(readFileSync(resultsPath, "utf8"));
    const rows = (parsed?.results?.results ?? []).map((result) => ({
        test: result.testCase?.description ?? `test #${result.testIdx}`,
        pass: result.success === true,
        score: typeof result.score === "number" ? result.score : 0,
        costUsd: typeof result.cost === "number" ? result.cost : 0,
        latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : 0,
        tokens: result.tokenUsage?.total ?? 0,
    }));
    const passed = rows.filter((row) => row.pass).length;
    const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);
    const totalLatency = rows.reduce((sum, row) => sum + row.latencyMs, 0);
    const lines = [
        `# Bench summary — ${timestamp}`,
        "",
        `Profile passthrough: \`${process.env.PROFILE || process.env.AGENT_PROFILE || "default"}\` (per-test vars may override).`,
        "",
        "| test | pass | score | cost | latency | tokens |",
        "| --- | --- | --- | --- | --- | --- |",
        ...rows.map(
            (row) =>
                `| ${row.test} | ${row.pass ? "✅" : "❌"} | ${row.score.toFixed(2)} | ${formatUsd(row.costUsd)} | ${formatSeconds(row.latencyMs)} | ${row.tokens} |`,
        ),
        `| **total** | ${passed}/${rows.length} | | ${formatUsd(totalCost)} | ${formatSeconds(totalLatency)} | ${rows.reduce((sum, row) => sum + row.tokens, 0)} |`,
        "",
    ];
    const summaryPath = path.join(outDir, "summary.md");
    writeFileSync(summaryPath, lines.join("\n"));
    console.log(`[bench] results: ${resultsPath}`);
    console.log(`[bench] summary: ${summaryPath}`);
    console.log(lines.join("\n"));
} catch (error) {
    console.error(`[bench] could not summarize ${resultsPath}: ${error instanceof Error ? error.message : error}`);
}

process.exit(run.status ?? 1);
