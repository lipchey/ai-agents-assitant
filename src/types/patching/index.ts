import { OriginalReadKind } from "../../consts";

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
    | { kind: typeof OriginalReadKind.FOUND; content: string }
    | { kind: typeof OriginalReadKind.MISSING }
    | { kind: typeof OriginalReadKind.ERROR; message: string };
