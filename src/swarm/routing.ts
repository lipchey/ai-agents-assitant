// Swarm conditional-edge routers. Worker → compress on success; reasoning failure
// → SME oracle; environment failure → human gate; exhausted escalation → blocked.
import { SWARM_BLOCKED_ROUTE, SwarmNode } from "../constants.js";
import { FailureType, WorkerKind, WorkerStatus } from "../enums.js";
import { SwarmWorkerState } from "../state.js";

type WorkerState = typeof SwarmWorkerState.State;

// Bounds how many times the swarm may re-attempt after an escalation (SME or
// human gate) before terminating as blocked.
export const MAX_ESCALATION_ATTEMPTS = 2;

const WORKER_NODE: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: SwarmNode.CODE_EXPLORER,
    [WorkerKind.INFRA_OPS]: SwarmNode.INFRA_OPS,
    [WorkerKind.WEB_RESEARCHER]: SwarmNode.WEB_RESEARCHER,
};

export const delegateToWorker = (state: WorkerState): string =>
    WORKER_NODE[state.workerKind] ?? SwarmNode.CODE_EXPLORER;

export const routeAfterWorker = (state: WorkerState): string => {
    if (state.status === WorkerStatus.DONE) {
        return SwarmNode.WORKER_COMPRESS;
    }
    if ((state.escalationAttempts ?? 0) >= MAX_ESCALATION_ATTEMPTS) {
        return SWARM_BLOCKED_ROUTE;
    }
    if (state.failureType === FailureType.REASONING) {
        return SwarmNode.SME_ORACLE;
    }
    return SwarmNode.HUMAN_GATE;
};

export const routeAfterSme = (state: WorkerState): string =>
    state.escalationResponse ? delegateToWorker(state) : SWARM_BLOCKED_ROUTE;

export const routeAfterHuman = (state: WorkerState): string =>
    state.status === WorkerStatus.BLOCKED ? SWARM_BLOCKED_ROUTE : delegateToWorker(state);
