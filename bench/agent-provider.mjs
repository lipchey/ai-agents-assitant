/* Custom promptfoo provider (spec D7): wraps the in-process programmatic
   entrypoint runAgentTask and maps the frozen RunSummary contract onto
   promptfoo's ProviderResponse (output + cost + tokenUsage + metadata).
   Referenced from promptfooconfig.yaml as file://./agent-provider.mjs; tsx
   makes the TypeScript source importable without a build step. */
import "dotenv/config";
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
const { runAgentTask } = await import("../src/index.ts");

const FIXTURES_ROOT = fileURLToPath(new URL("./fixtures/", import.meta.url));
const WORK_ROOT = path.resolve("bench/.work");

/* Per-test profile selection: an explicit test var wins, then the PROFILE /
   AGENT_PROFILE environment passthrough (run-task.sh convention), then default. */
const resolveProfile = (vars) => {
    if (typeof vars.profile === "string" && vars.profile.trim()) {
        return vars.profile.trim();
    }
    const fromEnv = (process.env.PROFILE ?? "").trim() || (process.env.AGENT_PROFILE ?? "").trim();
    return fromEnv || "default";
};

/* Coding tests run against a disposable fixture copy, reset before every call
   so reruns never see a previously patched tree. The copy must stay inside
   bench/.work: the path comes from test vars and is used with rmSync. */
const resetFixtureCopy = (vars) => {
    if (typeof vars.fixture !== "string" || typeof vars.fixtureCopy !== "string") {
        return;
    }
    const source = path.join(FIXTURES_ROOT, vars.fixture);
    const target = path.resolve(vars.fixtureCopy);
    if (target !== WORK_ROOT && !target.startsWith(WORK_ROOT + path.sep)) {
        throw new Error(`fixtureCopy must live under bench/.work, got: ${vars.fixtureCopy}`);
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
};

export default class AgentProvider {
    constructor(options = {}) {
        this.providerId = options.id ?? "ai-agents-assitant";
        this.config = options.config ?? {};
    }

    id() {
        return this.providerId;
    }

    async callApi(prompt, context) {
        const vars = context?.vars ?? {};
        try {
            resetFixtureCopy(vars);
            /* A malformed budget var coerces to NaN, which the graph would treat
               as an unlimited budget; reject it here (a setup failure, so error
               is correct) before any live run starts, mirroring runAgentTask. */
            const budgetUsd = Number(vars.budgetUsd ?? this.config.defaultBudgetUsd ?? 0.05);
            if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
                return { output: "", error: `Invalid budgetUsd var: "${String(vars.budgetUsd)}"` };
            }
            const summary = await runAgentTask(String(prompt), {
                profile: resolveProfile(vars),
                budgetUsd,
                applyPatches: vars.applyPatches === true || vars.applyPatches === "true",
                hitl: "off",
            });
            /* ProviderResponse.error is reserved for the catch path below: promptfoo
               treats a set error as an infrastructure ERROR and short-circuits before
               running assertions. A status:"failed" run completed enough to produce a
               RunSummary, so keep output/cost/tokens and surface the failure text in
               metadata so the suite's objective asserts grade (and fail) the row. */
            return {
                output: summary.answer,
                cost: summary.totalCostUsd,
                tokenUsage: { total: summary.totalTokens },
                metadata: {
                    runId: summary.runId,
                    profileName: summary.profileName,
                    status: summary.status,
                    durationMs: summary.durationMs,
                    ...(summary.status === "failed" ? { error: summary.error ?? "agent run failed" } : {}),
                    ...(typeof summary.verificationPassed === "boolean"
                        ? { verificationPassed: summary.verificationPassed }
                        : {}),
                },
            };
        } catch (error) {
            /* Setup/startup failures (bad profile, gateway down) have no
               RunSummary; report them as a graceful provider error. */
            return { output: "", error: error instanceof Error ? error.message : String(error) };
        }
    }
}
