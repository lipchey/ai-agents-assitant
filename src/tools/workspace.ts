/* All filesystem-touching tools resolve here to prevent workspace escapes. */
import path from "node:path";
import { OpenClawError } from "./errors.ts";

/* One agent run per process. The workspace root governs only filesystem TOOLS
   and PATCHING; profile and pricing loading deliberately stay process.cwd()-anchored
   (the agent installation), so an injected root relocates the work tree without
   moving the agent's own config/pricing lookups. Default is process.cwd(). */
let workspaceRoot: string | undefined;

export const getWorkspaceRoot = (): string => workspaceRoot ?? process.cwd();

export const setWorkspaceRoot = (dir: string | undefined): void => {
    workspaceRoot = dir;
};

export const resolveWorkspacePath = (inputPath: string): string => {
    const root = getWorkspaceRoot();
    const resolved = path.resolve(root, inputPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new OpenClawError(`Path escapes workspace: ${inputPath}`);
    }
    return resolved;
};
