// Workspace path guard. Every local tool that touches the filesystem (and the
// patch applier) resolves through this so a path can never escape the repo root.
import path from "node:path";
import { OpenClawError } from "./errors.js";

export const resolveWorkspacePath = (inputPath: string): string => {
    const workspaceRoot = process.cwd();
    const resolved = path.resolve(workspaceRoot, inputPath);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new OpenClawError(`Path escapes workspace: ${inputPath}`);
    }
    return resolved;
};
