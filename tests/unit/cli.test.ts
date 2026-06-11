/*
 * Tests for the R6 CLI profile surface: --profile parsing in parseCliArgs and
 * the loadActiveProfile precedence (explicit flag > AGENT_PROFILE env > default,
 * with a blank env value falling back to the default — the run-task.sh PROFILE
 * passthrough exports an empty string when unset).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args.ts";
import { explicitProfileSelection, loadActiveProfile, resolveResumeProfile } from "../../src/cli/config.ts";
import { EnvVar } from "../../src/consts/env.ts";
import { RunStatus } from "../../src/consts/run.ts";
import { writeRunSummary } from "../../src/run/run-summary.ts";
import type { RunSummary } from "../../src/run/run-summary.ts";

const PROFILE_ENV = EnvVar.PROFILE;
const previousEnv = process.env[PROFILE_ENV];

afterEach(() => {
    if (previousEnv === undefined) {
        delete process.env[PROFILE_ENV];
    } else {
        process.env[PROFILE_ENV] = previousEnv;
    }
});

describe("parseCliArgs --profile", () => {
    it("parses --profile alongside the task tokens", () => {
        expect(parseCliArgs(["--profile", "personal-dev", "do", "the", "thing"])).toEqual({
            task: "do the thing",
            help: false,
            profile: "personal-dev",
        });
    });

    it("omits the profile key entirely when the flag is absent", () => {
        expect(parseCliArgs(["task"])).toEqual({ task: "task", help: false });
    });

    it("throws when --profile has no value", () => {
        expect(() => parseCliArgs(["--profile"])).toThrow(/--profile requires/u);
    });

    it("throws when --profile is followed by another flag", () => {
        expect(() => parseCliArgs(["--profile", "--resume"])).toThrow(/--profile requires/u);
    });
});

describe("loadActiveProfile precedence", () => {
    it("prefers the explicit CLI value over AGENT_PROFILE", () => {
        process.env[PROFILE_ENV] = "client-baseline";
        expect(loadActiveProfile("personal-dev").name).toBe("personal-dev");
    });

    it("falls back to AGENT_PROFILE when no CLI value is given", () => {
        process.env[PROFILE_ENV] = "research-playground";
        expect(loadActiveProfile().name).toBe("research-playground");
    });

    it("treats a blank AGENT_PROFILE as unset and loads the default", () => {
        process.env[PROFILE_ENV] = "  ";
        expect(loadActiveProfile().name).toBe("default");
    });

    it("loads the default profile when neither source is set", () => {
        delete process.env[PROFILE_ENV];
        expect(loadActiveProfile().name).toBe("default");
    });
});

describe("explicitProfileSelection", () => {
    it("returns the CLI value over a set AGENT_PROFILE", () => {
        process.env[PROFILE_ENV] = "client-baseline";
        expect(explicitProfileSelection("personal-dev")).toBe("personal-dev");
    });

    it("returns a non-blank AGENT_PROFILE when no CLI value is given", () => {
        process.env[PROFILE_ENV] = "research-playground";
        expect(explicitProfileSelection()).toBe("research-playground");
    });

    it("returns undefined for a blank AGENT_PROFILE (no explicit selection)", () => {
        process.env[PROFILE_ENV] = "  ";
        expect(explicitProfileSelection()).toBeUndefined();
    });

    it("returns undefined when neither source is set", () => {
        delete process.env[PROFILE_ENV];
        expect(explicitProfileSelection()).toBeUndefined();
    });
});

describe("resolveResumeProfile", () => {
    const writeSummaryWithProfile = (dir: string, profileName: string): string => {
        const runId = randomUUID();
        const summary: RunSummary = {
            runId,
            task: "original task",
            profileName,
            status: RunStatus.COMPLETED,
            answer: "done",
            totalCostUsd: 0,
            totalTokens: 0,
            usageStats: {},
            durationMs: 1,
            nodeVisits: [],
        };
        writeRunSummary(summary, dir);
        return runId;
    };

    it("recovers the original run's profile when the operator made no explicit selection", () => {
        delete process.env[PROFILE_ENV];
        const dir = mkdtempSync(join(tmpdir(), "resume-profile-"));
        const runId = writeSummaryWithProfile(dir, "personal-dev");

        const resolution = resolveResumeProfile(runId, undefined, dir);

        expect(resolution.source).toBe("recovered");
        expect(resolution.profile.name).toBe("personal-dev");
        expect(resolution.recordedName).toBe("personal-dev");
    });

    it("honors an explicit --profile that differs from the recorded one, surfacing the conflict", () => {
        delete process.env[PROFILE_ENV];
        const dir = mkdtempSync(join(tmpdir(), "resume-profile-"));
        const runId = writeSummaryWithProfile(dir, "personal-dev");

        const resolution = resolveResumeProfile(runId, "research-playground", dir);

        expect(resolution.source).toBe("explicit");
        expect(resolution.profile.name).toBe("research-playground");
        expect(resolution.recordedName).toBe("personal-dev");
    });

    it("falls back to the default profile when no run summary exists", () => {
        delete process.env[PROFILE_ENV];
        const dir = mkdtempSync(join(tmpdir(), "resume-profile-"));

        const resolution = resolveResumeProfile(randomUUID(), undefined, dir);

        expect(resolution.source).toBe("fallback");
        expect(resolution.profile.name).toBe("default");
        expect(resolution.recordedName).toBeUndefined();
    });
});
