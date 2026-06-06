export type PatchBlock = {
    path: string;
    content: string;
};

export type ApplyPatchesResult = {
    applied: string[];
    newBackups: Record<string, string>;
    created: string[];
    report: string;
};

export type OriginalReadResult =
    | { kind: "found"; content: string }
    | { kind: "missing" }
    | { kind: "error"; message: string };
