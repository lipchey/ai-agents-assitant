/* All filesystem-touching tools resolve here to prevent workspace escapes. */
import path from "node:path";
import { OpenClawError } from "./errors.ts";

export const resolveWorkspacePath = (inputPath: string): string => {
    const workspaceRoot = process.cwd();
    const resolved = path.resolve(workspaceRoot, inputPath);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new OpenClawError(`Path escapes workspace: ${inputPath}`);
    }
    return resolved;
};
