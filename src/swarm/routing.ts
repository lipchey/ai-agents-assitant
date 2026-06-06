import { SWARM_BLOCKED_ROUTE, SwarmNode, FailureType, WorkerKind, WorkerStatus } from "../consts";
import type { SwarmWorkerStateValue } from "../state";

/* Bounded retries keep SME/HITL escalation from cycling forever. */
export const MAX_ESCALATION_ATTEMPTS = 2;

const WORKER_NODE: Record<WorkerKind, string> = {
    [WorkerKind.CODE_EXPLORER]: SwarmNode.CODE_EXPLORER,
    [WorkerKind.INFRA_OPS]: SwarmNode.INFRA_OPS,
    [WorkerKind.WEB_RESEARCHER]: SwarmNode.WEB_RESEARCHER,
};

export const delegateToWorker = (state: SwarmWorkerStateValue): string =>
    WORKER_NODE[state.workerKind] ?? SwarmNode.CODE_EXPLORER;

export const routeAfterWorker = (state: SwarmWorkerStateValue): string => {
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

export const routeAfterSme = (state: SwarmWorkerStateValue): string =>
    state.escalationResponse ? delegateToWorker(state) : SWARM_BLOCKED_ROUTE;

export const routeAfterHuman = (state: SwarmWorkerStateValue): string =>
    state.status === WorkerStatus.BLOCKED ? SWARM_BLOCKED_ROUTE : delegateToWorker(state);
