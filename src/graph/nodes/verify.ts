// Objective verification gate. Consensus != correctness, so the finalized code is
// tested with `npm run typecheck`. Pure-reasoning output has nothing to compile,
// so it short-circuits to accept the consensus draft.
import { ToolName, ToolStatus, VERIFY_TYPECHECK_COMMAND } from "../../constants.js";
import { errorMessage } from "../../shared/text.js";
import { openclawRpc } from "../../tools/openclaw.js";
import { extractToolStatus } from "../parsers.js";
import type { GraphStateValue } from "../types.js";

const VERIFY_TIMEOUT_S = 120;
const VERIFY_RPC_TIMEOUT_S = 150;

export const verify = async (state: GraphStateValue) => {
    const verifyAttempts = (state.verifyAttempts ?? 0) + 1;

    if (state.complexity === "pure_reasoning") {
        return {
            verificationPassed: true,
            verificationReport: "Skipped objective typecheck: pure_reasoning output has no code to compile.",
            bestDraft: state.currentDraft || state.bestDraft || "",
            verifyAttempts,
        };
    }

    try {
        const report = await openclawRpc(
            ToolName.RUN_TESTS,
            { command: VERIFY_TYPECHECK_COMMAND, timeout: VERIFY_TIMEOUT_S },
            { timeoutS: VERIFY_RPC_TIMEOUT_S, idempotencyKey: `verify-${state.debateIterations}`, maxRetries: 0 },
        );
        const { status, exitCode } = extractToolStatus(report);
        const passed = status === ToolStatus.COMPLETED && (exitCode === undefined || exitCode === 0);

        return {
            verificationPassed: passed,
            verificationReport: JSON.stringify(report, null, 2),
            bestDraft: passed ? state.currentDraft : state.bestDraft || "",
            verifyAttempts,
        };
    } catch (error) {
        return {
            verificationPassed: false,
            verificationReport: `Verification failed before tests completed: ${errorMessage(error)}`,
            verifyAttempts,
        };
    }
};
