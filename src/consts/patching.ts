/* Structured patch blocks are the only draft text that may touch disk. */
export const PATCH_BLOCK = /<<<PATCH\s+(?:file|path)\s*=\s*"([^"]+)"\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END\s+PATCH>>>/gu;

/* Guard protected repository/runtime directories even after workspace resolution. */
export const PROTECTED_SEGMENTS = new Set([".git", "node_modules"]);

export const OriginalReadKind = {
    FOUND: "found",
    MISSING: "missing",
    ERROR: "error",
} as const;

export type OriginalReadKind = (typeof OriginalReadKind)[keyof typeof OriginalReadKind];

export const MISSING_FILE_ERROR_CODE = "ENOENT";
