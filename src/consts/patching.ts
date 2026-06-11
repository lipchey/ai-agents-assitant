/* Structured patch blocks are the only draft text that may touch disk. */
export const PATCH_BLOCK = /<<<PATCH\s+(?:file|path)\s*=\s*"([^"]+)"\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END\s+PATCH>>>/gu;

/* Guard protected repository/runtime directories anywhere in the path even after workspace resolution. */
export const PROTECTED_SEGMENTS = new Set([".git", "node_modules", ".github", ".githooks"]);

/* Build/quality manifests the patch engine must never rewrite, in any directory. */
export const PROTECTED_BASENAMES = new Set(["package.json", "package-lock.json", "tsconfig.json", "quality.json"]);

/* Secret/config files guarded by basename prefix in any directory (.env*, openclaw.config.json5*). */
export const PROTECTED_BASENAME_PREFIXES = [".env", "openclaw.config.json5"] as const;

/* Workspace-root-only gate trees: blocks the root verify shim and root tools/ + schemas/ while leaving src/tools/** patchable. */
export const PROTECTED_ROOT_SEGMENTS = new Set(["verify", "tools", "schemas"]);

export const OriginalReadKind = {
    FOUND: "found",
    MISSING: "missing",
    ERROR: "error",
} as const;

export type OriginalReadKind = (typeof OriginalReadKind)[keyof typeof OriginalReadKind];

export const MISSING_FILE_ERROR_CODE = "ENOENT";
