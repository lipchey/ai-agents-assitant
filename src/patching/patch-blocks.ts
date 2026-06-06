/* Opt-in patches are structured-only and snapshot pristine files for rollback. */
import fs from "node:fs/promises";
import path from "node:path";
import { MISSING_FILE_ERROR_CODE, OriginalReadKind, PATCH_BLOCK, PROTECTED_SEGMENTS } from "../consts";
import { resolveWorkspacePath } from "../tools";
import type { ApplyPatchesResult, OriginalReadResult, PatchBlock } from "../types/patching";

const isProtectedPath = (relativePath: string): boolean => {
    return relativePath
        .split(/[\\/]/u)
        .some((segment) => PROTECTED_SEGMENTS.has(segment));
};

/* Later blocks for the same path win; prose outside delimiters never touches disk. */
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

const readOriginal = async (resolved: string): Promise<OriginalReadResult> => {
    try {
        return { kind: OriginalReadKind.FOUND, content: await fs.readFile(resolved, "utf8") };
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === MISSING_FILE_ERROR_CODE) {
            return { kind: OriginalReadKind.MISSING };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { kind: OriginalReadKind.ERROR, message };
    }
};

/* alreadyHandled preserves the first pristine snapshot across verify/fix retries. */
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
        if (original.kind === OriginalReadKind.ERROR) {
            skipped.push(`${block.path} (read failed: ${original.message})`);
            continue;
        }

        try {
            await fs.mkdir(path.dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, block.content, "utf8");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            skipped.push(`${block.path} (write failed: ${message})`);
            continue;
        }

        if (!alreadyHandled.has(relative)) {
            if (original.kind === OriginalReadKind.MISSING) {
                created.push(relative);
            } else {
                newBackups[relative] = original.content;
            }
        }
        applied.push(relative);
    }

    const reportLines = [
        applied.length > 0 ? `Applied ${applied.length} file(s): ${applied.join(", ")}.` : "No files applied.",
        created.length > 0 ? `Created: ${created.join(", ")}.` : "",
        skipped.length > 0 ? `Skipped (guarded): ${skipped.join("; ")}.` : "",
    ].filter(Boolean);

    return { applied, newBackups, created, report: reportLines.join(" ") };
};

/* Failed guarded runs must leave the workspace as they found it. */
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
