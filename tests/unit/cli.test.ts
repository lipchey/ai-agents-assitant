/*
 * Tests for the R6 CLI profile surface: --profile parsing in parseCliArgs and
 * the loadActiveProfile precedence (explicit flag > AGENT_PROFILE env > default,
 * with a blank env value falling back to the default — the run-task.sh PROFILE
 * passthrough exports an empty string when unset).
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args.ts";
import { loadActiveProfile } from "../../src/cli/config.ts";
import { EnvVar } from "../../src/consts/env.ts";

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
