import { STRONG_ESCALATION_SIGNALS } from "../consts";

export const strongEscalationReasonForTask = (task: string): string | undefined => {
    const signal = STRONG_ESCALATION_SIGNALS.find((pattern) => pattern.test(task));
    return signal ? `Task matched high-risk escalation signal: ${signal.source}` : undefined;
};
