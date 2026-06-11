/* Programmatic assert for the coding tasks (plan R7.3): the agent's patch must
   actually land in the fixture copy and the copy must typecheck. Promptfoo
   calls the default export with (output, context); context.vars carries the
   fixture paths set in suites/smoke.yaml. */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TSC_TIMEOUT_MS = 120_000;

const readOrEmpty = (file) => {
    try {
        return readFileSync(file, "utf8");
    } catch {
        return "";
    }
};

export default async function fixtureTypechecks(_output, context) {
    const vars = context?.vars ?? {};
    const copyRoot = path.resolve(String(vars.fixtureCopy ?? ""));
    const fixtureRoot = path.resolve("bench/fixtures", String(vars.fixture ?? ""));
    const changedRel = String(vars.mustChangeFile ?? "");

    const patched = readOrEmpty(path.join(copyRoot, changedRel));
    const original = readOrEmpty(path.join(fixtureRoot, changedRel));
    if (!patched || patched === original) {
        return { pass: false, score: 0, reason: `no patch applied: ${changedRel} is unchanged in ${copyRoot}` };
    }
    if (typeof vars.requireInFile === "string" && vars.requireInFile && !patched.includes(vars.requireInFile)) {
        return { pass: false, score: 0, reason: `${changedRel} does not contain "${vars.requireInFile}"` };
    }

    try {
        await execFileAsync(path.resolve("node_modules/.bin/tsc"), ["--noEmit", "-p", copyRoot], {
            timeout: TSC_TIMEOUT_MS,
        });
    } catch (error) {
        const detail = [error?.stdout, error?.stderr].filter(Boolean).join("\n").trim();
        return {
            pass: false,
            score: 0,
            reason: `tsc --noEmit failed in ${copyRoot}:\n${(detail || String(error?.message ?? error)).slice(0, 2000)}`,
        };
    }
    return { pass: true, score: 1, reason: "patch applied and the fixture copy typechecks" };
}
