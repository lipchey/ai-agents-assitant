/* Keep aligned with frontierArchitect/frontierCritic escalation prompt copy. */
export const CONFIDENCE_ESCALATION_THRESHOLD = 0.72;

/* Default soft cost cap; AGENT_COST_BUDGET_USD can override it at runtime. */
export const DEFAULT_COST_BUDGET_USD = 1;

/* Recursion headroom protects bounded loops; per-cycle caps remain the real guard. */
export const MAIN_GRAPH_RECURSION_LIMIT = 50;

/* Soft budget checks stop before the hard user-provided USD ceiling. */
export const COST_BUDGET_SOFT_CEILING_RATIO = 0.95;

/* Tiny remaining budgets should finalize instead of starting another model cycle. */
export const COST_BUDGET_MIN_REMAINING_USD = 0.005;

/* Budget projections are conservative cycle-level estimates for routing gates. */
export const PROJECTED_CONTEXT_REFETCH_CYCLE_USD = 0.08;
export const PROJECTED_STRONG_ARCHITECT_USD = 0.05;
export const PROJECTED_CODER_REVIEW_CYCLE_USD = 0.06;
export const PROJECTED_STRONG_CRITIC_USD = 0.05;
export const PROJECTED_SME_TIEBREAKER_USD = 0.05;

/* Debate cap prevents critic loops from becoming the default implementation path. */
export const MAX_DEBATE_ITERATIONS = 4;

/* Two total fetches means the primary swarm pass plus one targeted refetch. */
export const MAX_CONTEXT_FETCHES = 2;

/* Verification is objective but bounded so broken drafts converge to final feedback. */
export const MAX_VERIFY_ATTEMPTS = 2;

/* Patch-format retries are cheaper than verification retries and capped separately. */
export const MAX_PATCH_FORMAT_RETRIES = 2;

/* Refetch focus terms are ranked; this limit keeps follow-up context narrow. */
export const MAX_CONTEXT_SEARCH_TERMS = 10;

/* Recent debate snippets are enough for critics without replaying full history. */
export const RECENT_DEBATE_WINDOW = 3;

/* Objective verification runs can take longer than ordinary tool calls. */
export const VERIFY_TIMEOUT_S = 120;
export const VERIFY_RPC_TIMEOUT_S = 150;

/* Verification feedback keeps first failures plus recent summaries without replaying full payloads. */
export const VERIFY_REPORT_OUTPUT_HEAD_LINES = 20;
export const VERIFY_REPORT_OUTPUT_TAIL_LINES = 60;
export const VERIFY_REPORT_OUTPUT_MAX_CHARS = 12_000;

/* ReAct workers are bounded so failed plans escalate instead of spinning. */
export const MAX_REACT_STEPS = 6;
export const MAX_REACT_TOOL_FAILURES = 3;

/* Planner context is capped; full tool output still goes to artifacts. */
export const MAX_OBSERVATION_CHARS = 1_600;
export const MAX_PRIOR_TRANSCRIPT_CHARS = 8_000;
export const MAX_ACTION_SUMMARY_CHARS = 200;

/* Shell verification is slower than read-only inspection. */
export const SHELL_EXEC_TIMEOUT_S = 120;
export const TOOL_TIMEOUT_S = 45;

/* Provider-layer retry default; consumed by the R3 retry layer and profile tuning. */
export const DEFAULT_LLM_MAX_RETRIES = 2;

/* Full-jitter backoff base: retry n sleeps uniform in [0, base * 2^n) ms. */
export const LLM_RETRY_BASE_DELAY_MS = 500;

/* Bounded retries keep SME/HITL escalation from cycling forever. */
export const MAX_ESCALATION_ATTEMPTS = 2;

/* Defensive cap beyond the swarm's own escalation bound. */
export const DEFAULT_MAX_HITL_ROUNDS = 6;

/* Blocked-worker fallbacks must not leak a full raw transcript into prompts. */
export const MAX_BLOCKED_FALLBACK_CHARS = 600;
