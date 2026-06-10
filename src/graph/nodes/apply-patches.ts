/* No applicable patch blocks bounce to coder instead of verifying an unchanged tree. */
import { GraphComplexity } from "../../consts";
import { applyPatchBlocks, parsePatchBlocks } from "../../patching";
import type { GraphStateValue } from "../../state";

export const applyPatches = async (state: GraphStateValue) => {
    if (!state.patchApplicationEnabled || state.complexity === GraphComplexity.PURE_REASONING) {
        return { patchApplicationFailed: false, awaitingPatchReformat: false };
    }

    const blocks = parsePatchBlocks(state.currentDraft || "");
    if (blocks.length === 0) {
        const report =
            "Patch application enabled but the draft contained no structured <<<PATCH>>> blocks; verification was skipped because no repository files changed.";
        return {
            patchApplicationFailed: true,
            verificationPassed: false,
            verificationReport: `${report} Emit complete file contents in <<<PATCH file="relative/path">>> blocks.`,
            patchFormatRetries: (state.patchFormatRetries ?? 0) + 1,
            awaitingPatchReformat: true,
            patchReport: report,
        };
    }

    /* Re-entries must not overwrite the first pristine backup. */
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
