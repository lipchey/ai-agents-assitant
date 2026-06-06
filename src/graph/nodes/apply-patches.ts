// Guarded autonomous file mutation, between the debate/tiebreaker and `verify`,
// so verification tests the real mutated tree. No-op unless explicitly enabled;
// only structured patch blocks are written; pristine contents are recorded for
// rollback in finalize. When enabled but the draft has no applicable blocks, it
// bounces back to the coder (bounded) rather than verifying an unchanged tree.
import { applyPatchBlocks, parsePatchBlocks } from "../../patch.js";
import type { GraphStateValue } from "../types.js";

export const applyPatches = async (state: GraphStateValue) => {
    if (!state.patchApplicationEnabled || state.complexity === "pure_reasoning") {
        return { patchApplicationFailed: false, awaitingPatchReformat: false };
    }

    const blocks = parsePatchBlocks(state.currentDraft || "");
    if (blocks.length === 0) {
        const report = "Patch application enabled but the draft contained no structured <<<PATCH>>> blocks; verification was skipped because no repository files changed.";
        return {
            patchApplicationFailed: true,
            verificationPassed: false,
            verificationReport: `${report} Emit complete file contents in <<<PATCH file="relative/path">>> blocks.`,
            patchFormatRetries: (state.patchFormatRetries ?? 0) + 1,
            awaitingPatchReformat: true,
            patchReport: report,
        };
    }

    // Files whose pristine state was captured on an earlier pass (the verify/fix
    // loop can re-enter this node), so a true pristine backup is never overwritten.
    const alreadyHandled = new Set<string>([
        ...Object.keys(state.patchBackups ?? {}),
        ...(state.patchCreatedFiles ?? []),
    ]);
    const result = await applyPatchBlocks(blocks, alreadyHandled);
    if (result.applied.length === 0) {
        return {
            patchApplicationFailed: true,
            verificationPassed: false,
            verificationReport: `${result.report} Verification was skipped because patch guards prevented every file write.`,
            patchFormatRetries: (state.patchFormatRetries ?? 0) + 1,
            awaitingPatchReformat: true,
            patchReport: result.report,
        };
    }

    return {
        patchApplicationFailed: false,
        awaitingPatchReformat: false,
        patchApplied: state.patchApplied || result.applied.length > 0,
        appliedFiles: result.applied,
        patchBackups: result.newBackups,
        patchCreatedFiles: result.created,
        patchReport: result.report,
    };
};
