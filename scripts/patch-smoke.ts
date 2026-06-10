import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { applyPatchBlocks, parsePatchBlocks, rollbackPatches } from "../src";

const run = async (): Promise<void> => {
    const smokeDir = `.patch-smoke-${Date.now()}`;
    const existingPath = `${smokeDir}/existing.txt`;
    const createdPath = `${smokeDir}/created.txt`;
    const directoryTarget = `${smokeDir}/dir-target`;

    await fs.mkdir(path.join(process.cwd(), directoryTarget), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), existingPath), "original\n", "utf8");

    try {
        const blocks = parsePatchBlocks(`
<<<PATCH file="${existingPath}">>>
changed
<<<END PATCH>>>
<<<PATCH file="${createdPath}">>>
created
<<<END PATCH>>>
<<<PATCH file="../outside.txt">>>
outside
<<<END PATCH>>>
<<<PATCH file=".git/config">>>
protected
<<<END PATCH>>>
<<<PATCH file="${directoryTarget}">>>
directory overwrite
<<<END PATCH>>>
`);

        const applied = await applyPatchBlocks(blocks, new Set());
        assert.deepEqual(applied.applied.sort(), [createdPath, existingPath].sort());
        assert.deepEqual(Object.keys(applied.newBackups), [existingPath]);
        assert.deepEqual(applied.created, [createdPath]);
        assert.match(applied.report, /escapes workspace/u);
        assert.match(applied.report, /protected path/u);
        assert.match(applied.report, /read failed/u);
        assert.equal(await fs.readFile(path.join(process.cwd(), existingPath), "utf8"), "changed");
        assert.equal(await fs.readFile(path.join(process.cwd(), createdPath), "utf8"), "created");
        console.log("PASS: safe patch blocks apply; guarded targets are skipped");

        const rollbackReport = await rollbackPatches(applied.newBackups, applied.created);
        assert.match(rollbackReport, /Restored 1 file/u);
        assert.match(rollbackReport, /Removed 1 created file/u);
        assert.equal(await fs.readFile(path.join(process.cwd(), existingPath), "utf8"), "original\n");
        await assert.rejects(fs.readFile(path.join(process.cwd(), createdPath), "utf8"), /ENOENT/u);
        console.log("PASS: rollback restores pristine contents and removes created files");

        const allSkipped = await applyPatchBlocks(
            parsePatchBlocks(`
<<<PATCH file=".git/config">>>
still protected
<<<END PATCH>>>
`),
            new Set(),
        );
        assert.deepEqual(allSkipped.applied, []);
        assert.match(allSkipped.report, /No files applied/u);
        console.log("PASS: all-skipped patch pass reports no applied files");

        console.log("\nPatch guard smoke test passed.");
    } finally {
        await fs.rm(path.join(process.cwd(), smokeDir), { recursive: true, force: true });
    }
};

void run().catch((error) => {
    console.error("Patch guard smoke test FAILED:", error);
    process.exitCode = 1;
});
