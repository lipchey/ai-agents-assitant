/* Failed guarded patch runs roll back here so the workspace is not left broken. */
import { rollbackPatches } from "../../patching";
import type { GraphStateValue } from "../../types/graph";

export const finalize = async (state: GraphStateValue) => {
    const answer = state.bestDraft || state.currentDraft || state.architectureSpec || "";

    if (state.patchApplied && !state.verificationPassed) {
        const rollbackReport = await rollbackPatches(state.patchBackups ?? {}, state.patchCreatedFiles ?? []);
        return {
            finalAnswer: answer,
            patchReport:
                `${state.patchReport ?? ""}\nVerification failed; reverted applied changes. ${rollbackReport}`.trim(),
        };
    }

    if (state.patchApplied) {
        const kept = [...new Set(state.appliedFiles ?? [])];
        return {
            finalAnswer: answer,
            patchReport:
                `${state.patchReport ?? ""}\nVerification passed; kept ${kept.length} applied file(s): ${kept.join(", ")}.`.trim(),
        };
    }

    if (state.patchApplicationFailed) {
        return {
            finalAnswer: answer,
            patchReport:
                `${state.patchReport ?? ""}\nVerification did not run because patch application failed.`.trim(),
        };
    }

    return { finalAnswer: answer };
};
