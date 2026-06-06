// Deterministic high-risk escalation heuristic. When the task text matches a
// high-stakes domain, the frontier architect/critic are forced to escalate to the
// strong models regardless of their own confidence. Kept intentionally aligned
// with the escalation criteria in the frontierArchitect/frontierCritic prompts.

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
