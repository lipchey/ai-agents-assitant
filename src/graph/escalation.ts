/* Keep these high-risk signals aligned with the architect/critic prompt criteria. */

const STRONG_ESCALATION_SIGNALS = [
    /\bsecurity|authentication|authorization|authz|authn|crypto|encrypt|secret|token|permission\b/iu,
    /\bpayment|billing|invoice|pci|hipaa|gdpr|privacy|compliance|legal\b/iu,
    /\bproduction|prod|migration|database|schema|data loss|destructive|delete|rollback\b/iu,
    /\bconcurrency|distributed|race condition|deadlock|consistency|transaction\b/iu,
    /\bmulti-agent|orchestration|autonomous|human-in-the-loop|hitl|checkpointer\b/iu,
];

export const strongEscalationReasonForTask = (task: string): string | undefined => {
    const signal = STRONG_ESCALATION_SIGNALS.find((pattern) => pattern.test(task));
    return signal ? `Task matched high-risk escalation signal: ${signal.source}` : undefined;
};
