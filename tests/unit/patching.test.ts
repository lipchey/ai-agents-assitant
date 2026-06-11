import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { applyPatchBlocks } from "../../src/patching/patch-blocks.ts";

/*
 * Guards the widened isProtectedPath surface (spec D10 + the quality-gate surface):
 * the patch engine must refuse to rewrite its own gates, secret/config files, and
 * protected repository trees. isProtectedPath is module-private, so refusals are
 * asserted through applyPatchBlocks' skipped-report — protected blocks never touch
 * disk. The allowed cases write only under the gitignored reports/ tree, cleaned up
 * after each test, so nothing tracked is ever modified.
 */

const PROTECTED_TARGETS = [
    ".github/workflows/x.yml",
    ".githooks/pre-commit",
    ".env",
    ".env.example",
    "openclaw.config.json5",
    "openclaw.config.json5.last-good",
    "package.json",
    "nested/dir/package.json",
    "package-lock.json",
    "tsconfig.json",
    "quality.json",
    "verify",
    "tools/run-gitleaks",
    "schemas/quality.schema.json",
    ".git/config",
    "node_modules/x/y.js",
];

const TMP_DIR = "reports/tmp-patch-test";

const block = (targetPath: string) => ({ path: targetPath, content: "patched\n" });

describe("isProtectedPath guards (src/patching/patch-blocks.ts)", () => {
    afterEach(async () => {
        await rm(TMP_DIR, { recursive: true, force: true });
    });

    it("refuses every protected target as a guarded skip and writes nothing", async () => {
        const result = await applyPatchBlocks(PROTECTED_TARGETS.map(block), new Set());

        expect(result.applied).toEqual([]);
        expect(result.created).toEqual([]);
        for (const target of PROTECTED_TARGETS) {
            expect(result.report).toContain(`${target} (protected path)`);
        }
    });

    it.each([`${TMP_DIR}/example.ts`, `${TMP_DIR}/docs/notes.md`, `${TMP_DIR}/src/tools/example.ts`])(
        "does not refuse the unprotected path %s",
        async (target) => {
            const result = await applyPatchBlocks([block(target)], new Set());

            expect(result.report).not.toContain("(protected path)");
            expect(result.applied).toHaveLength(1);
            expect(result.created).toHaveLength(1);
        },
    );
});
