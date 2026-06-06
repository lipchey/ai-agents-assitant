/* Opt-in patches are structured-only and snapshot pristine files for rollback. */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "./tools/openclaw.js";
import type { ApplyPatchesResult, OriginalReadResult, PatchBlock } from "./types/patching/index.js";

export type { ApplyPatchesResult, OriginalReadResult, PatchBlock } from "./types/patching/index.js";

const PATCH_BLOCK = /<<<PATCH\s+(?:file|path)\s*=\s*"([^"]+)"\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END\s+PATCH>>>/gu;
const PROTECTED_SEGMENTS = new Set([".git", "node_modules"]);

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
        return { kind: "found", content: await fs.readFile(resolved, "utf8") };
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "ENOENT") {
            return { kind: "missing" };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "error", message };
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
        if (original.kind === "error") {
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
            if (original.kind === "missing") {
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
