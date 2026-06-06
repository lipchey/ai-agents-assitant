// Guarded patch-application stage.
//
// The reasoning layer's `claudeCoder` produces draft file contents but, by
// design, the rest of the framework never touched disk — verification ran
// `npm run typecheck` against the *unmodified* repository, so an objectively
// failing draft could never be fixed by another coder pass. This module lets
// the framework optionally mutate repository files autonomously, but only
// behind hard guards:
//   - It is OFF unless `patchApplicationEnabled` is set (env `AGENT_APPLY_PATCHES`).
//   - It only acts on explicitly delimited `<<<PATCH file="...">>> ... <<<END PATCH>>>`
//     blocks; free-form prose in a draft is never written to disk.
//   - Every target path is bounded to the workspace (`resolveWorkspacePath`) and
//     protected directories (`.git`, `node_modules`) are refused.
//   - Pristine (pre-run) contents of every touched file are captured so the
//     caller can roll back to the original state if verification ultimately fails.
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "./tools/openclaw.js";

export type PatchBlock = {
    path: string;
    content: string;
};

export type ApplyPatchesResult = {
    // Workspace-relative paths written on this pass (overwrite + create).
    applied: string[];
    // Pristine contents for files that already existed, keyed by relative path.
    // Only files NOT already present in `alreadyHandled` appear here so the
    // earliest (truly pristine) backup is never overwritten across retry loops.
    newBackups: Record<string, string>;
    // Files that did not exist before this run and were created by a patch.
    created: string[];
    // Human-readable summary for telemetry / the final report.
    report: string;
};

const PATCH_BLOCK = /<<<PATCH\s+(?:file|path)\s*=\s*"([^"]+)"\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END\s+PATCH>>>/gu;
const PROTECTED_SEGMENTS = new Set([".git", "node_modules"]);

const isProtectedPath = (relativePath: string): boolean => {
    return relativePath
        .split(/[\\/]/u)
        .some((segment) => PROTECTED_SEGMENTS.has(segment));
};

// Parse the structured patch blocks out of a coder draft. Later blocks for the
// same path win (the coder may restate a file after a critique), and prose
// outside the delimiters is ignored entirely.
export const parsePatchBlocks = (draft: string): PatchBlock[] => {
    const byPath = new Map<string, string>();
    for (const match of (draft ?? "").matchAll(PATCH_BLOCK)) {
        const targetPath = match[1]?.trim();
        if (!targetPath) {
            continue;
        }
        byPath.set(targetPath, (match[2] ?? "").replace(/\r\n/gu, "\n"));
    }
    return [...byPath.entries()].map(([targetPath, content]) => ({ path: targetPath, content }));
};

const readOriginal = async (resolved: string): Promise<string | null> => {
    try {
        return await fs.readFile(resolved, "utf8");
    } catch {
        return null;
    }
};

// Write every patch block to disk, capturing pristine backups for files that
// have not been touched earlier in this run. `alreadyHandled` carries the set of
// paths whose pristine state was already recorded on a previous pass so retries
// never clobber the original backup with already-patched content.
export const applyPatchBlocks = async (
    blocks: PatchBlock[],
    alreadyHandled: Set<string>,
): Promise<ApplyPatchesResult> => {
    const applied: string[] = [];
    const newBackups: Record<string, string> = {};
    const created: string[] = [];
    const skipped: string[] = [];

    for (const block of blocks) {
        let resolved: string;
        try {
            resolved = resolveWorkspacePath(block.path);
        } catch {
            skipped.push(`${block.path} (escapes workspace)`);
            continue;
        }
        const relative = path.relative(process.cwd(), resolved);
        if (isProtectedPath(relative)) {
            skipped.push(`${block.path} (protected path)`);
            continue;
        }

        const original = await readOriginal(resolved);
        if (!alreadyHandled.has(relative)) {
            if (original === null) {
                created.push(relative);
            } else {
                newBackups[relative] = original;
            }
        }

        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, block.content, "utf8");
        applied.push(relative);
    }

    const reportLines = [
        applied.length > 0 ? `Applied ${applied.length} file(s): ${applied.join(", ")}.` : "No files applied.",
        created.length > 0 ? `Created: ${created.join(", ")}.` : "",
        skipped.length > 0 ? `Skipped (guarded): ${skipped.join("; ")}.` : "",
    ].filter(Boolean);

    return { applied, newBackups, created, report: reportLines.join(" ") };
};

// Restore the repository to its pre-run state: rewrite backed-up files to their
// pristine contents and delete files the run created. Used when verification
// ultimately fails so a guarded autonomous run never leaves a broken tree behind.
export const rollbackPatches = async (
    backups: Record<string, string>,
    created: string[],
): Promise<string> => {
    const restored: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];

    for (const [relative, content] of Object.entries(backups)) {
        try {
            await fs.writeFile(resolveWorkspacePath(relative), content, "utf8");
            restored.push(relative);
        } catch (error) {
            errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    for (const relative of new Set(created)) {
        try {
            await fs.rm(resolveWorkspacePath(relative), { force: true });
            removed.push(relative);
        } catch (error) {
            errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (restored.length === 0 && removed.length === 0 && errors.length === 0) {
        return "Rollback: nothing to revert.";
    }
    return [
        restored.length > 0 ? `Restored ${restored.length} file(s): ${restored.join(", ")}.` : "",
        removed.length > 0 ? `Removed ${removed.length} created file(s): ${removed.join(", ")}.` : "",
        errors.length > 0 ? `Rollback errors: ${errors.join("; ")}.` : "",
    ].filter(Boolean).join(" ");
};
