/* Consensus is not correctness; code paths still need an objective typecheck. */
import { GraphComplexity, ToolName, ToolStatus, VERIFY_RPC_TIMEOUT_S, VERIFY_TIMEOUT_S, VERIFY_TYPECHECK_COMMAND } from "../../consts";
import { errorMessage } from "../../shared";
import { openclawRpc } from "../../tools";
import { extractToolStatus } from "../parsers.ts";
import type { GraphStateValue } from "../../types/graph";

export const verify = async (state: GraphStateValue) => {
    const verifyAttempts = (state.verifyAttempts ?? 0) + 1;

    if (state.complexity === GraphComplexity.PURE_REASONING) {
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
