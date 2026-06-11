import { describe, it, expect } from "vitest";
import {
    FailureType,
    MAX_ESCALATION_ATTEMPTS,
    SWARM_BLOCKED_ROUTE,
    SwarmNode,
    WorkerKind,
    WorkerStatus,
} from "../../src/consts";
import { delegateToWorker, routeAfterHuman, routeAfterSme, routeAfterWorker } from "../../src/swarm/routing.ts";
import type { SwarmWorkerStateValue } from "../../src/state";

const BASE_STATE: SwarmWorkerStateValue = {
    subtask: "characterization fixture subtask",
    workerKind: WorkerKind.CODE_EXPLORER,
    rawToolOutput: "",
    toolCalls: [],
    attempts: 0,
    status: WorkerStatus.WORKING,
    failureType: FailureType.NONE,
    escalationQuery: "",
    escalationResponse: "",
    escalationAttempts: 0,
    workerSummary: "",
    producedArtifacts: {},
    totalCost: 0,
    totalTokens: 0,
    usageStats: {},
};

const makeState = (overrides: Partial<SwarmWorkerStateValue>): SwarmWorkerStateValue => ({
    ...BASE_STATE,
    ...overrides,
});

describe("delegateToWorker", () => {
    it("routes code_explorer to the code explorer node", () => {
        expect(delegateToWorker(makeState({ workerKind: WorkerKind.CODE_EXPLORER }))).toBe(SwarmNode.CODE_EXPLORER);
    });

    it("routes infra_ops to the infra ops node", () => {
        expect(delegateToWorker(makeState({ workerKind: WorkerKind.INFRA_OPS }))).toBe(SwarmNode.INFRA_OPS);
    });

    it("routes web_researcher to the web researcher node", () => {
        expect(delegateToWorker(makeState({ workerKind: WorkerKind.WEB_RESEARCHER }))).toBe(SwarmNode.WEB_RESEARCHER);
    });
});

describe("routeAfterWorker", () => {
    it("sends a done worker to compression", () => {
        expect(routeAfterWorker(makeState({ status: WorkerStatus.DONE }))).toBe(SwarmNode.WORKER_COMPRESS);
    });

    it("prefers compression for a done worker even past the escalation cap with a reasoning failure", () => {
        expect(
            routeAfterWorker(
                makeState({
                    status: WorkerStatus.DONE,
                    escalationAttempts: MAX_ESCALATION_ATTEMPTS + 5,
                    failureType: FailureType.REASONING,
                }),
            ),
        ).toBe(SwarmNode.WORKER_COMPRESS);
    });

    it("blocks when escalation attempts reach the cap", () => {
        expect(
            routeAfterWorker(makeState({ status: WorkerStatus.WORKING, escalationAttempts: MAX_ESCALATION_ATTEMPTS })),
        ).toBe(SWARM_BLOCKED_ROUTE);
    });

    it("blocks when escalation attempts exceed the cap", () => {
        expect(
            routeAfterWorker(
                makeState({ status: WorkerStatus.WORKING, escalationAttempts: MAX_ESCALATION_ATTEMPTS + 1 }),
            ),
        ).toBe(SWARM_BLOCKED_ROUTE);
    });

    it("blocks at the cap even when the failure type is reasoning", () => {
        expect(
            routeAfterWorker(
                makeState({
                    status: WorkerStatus.WORKING,
                    escalationAttempts: MAX_ESCALATION_ATTEMPTS,
                    failureType: FailureType.REASONING,
                }),
            ),
        ).toBe(SWARM_BLOCKED_ROUTE);
    });

    it("escalates a reasoning failure below the cap to the SME oracle", () => {
        expect(
            routeAfterWorker(
                makeState({
                    status: WorkerStatus.WORKING,
                    escalationAttempts: MAX_ESCALATION_ATTEMPTS - 1,
                    failureType: FailureType.REASONING,
                }),
            ),
        ).toBe(SwarmNode.SME_ORACLE);
    });

    it("escalates a reasoning failure with zero prior attempts to the SME oracle", () => {
        expect(
            routeAfterWorker(
                makeState({ status: WorkerStatus.WORKING, escalationAttempts: 0, failureType: FailureType.REASONING }),
            ),
        ).toBe(SwarmNode.SME_ORACLE);
    });

    it("sends an environment failure below the cap to the human gate", () => {
        expect(
            routeAfterWorker(
                makeState({
                    status: WorkerStatus.WORKING,
                    escalationAttempts: 0,
                    failureType: FailureType.ENVIRONMENT,
                }),
            ),
        ).toBe(SwarmNode.HUMAN_GATE);
    });

    it("sends a none failure below the cap to the human gate", () => {
        expect(
            routeAfterWorker(
                makeState({ status: WorkerStatus.WORKING, escalationAttempts: 0, failureType: FailureType.NONE }),
            ),
        ).toBe(SwarmNode.HUMAN_GATE);
    });

    it("sends an unknown failure below the cap to the human gate", () => {
        expect(
            routeAfterWorker(
                makeState({ status: WorkerStatus.WORKING, escalationAttempts: 0, failureType: FailureType.UNKNOWN }),
            ),
        ).toBe(SwarmNode.HUMAN_GATE);
    });
});

describe("routeAfterSme", () => {
    it("re-delegates to the worker node when the SME produced a response", () => {
        expect(
            routeAfterSme(makeState({ escalationResponse: "oracle guidance", workerKind: WorkerKind.INFRA_OPS })),
        ).toBe(SwarmNode.INFRA_OPS);
    });

    it("re-delegates to the code explorer node when the SME produced a response", () => {
        expect(
            routeAfterSme(makeState({ escalationResponse: "oracle guidance", workerKind: WorkerKind.CODE_EXPLORER })),
        ).toBe(SwarmNode.CODE_EXPLORER);
    });

    it("blocks when the SME produced no response", () => {
        expect(routeAfterSme(makeState({ escalationResponse: "" }))).toBe(SWARM_BLOCKED_ROUTE);
    });
});

describe("routeAfterHuman", () => {
    it("blocks when the worker is blocked", () => {
        expect(routeAfterHuman(makeState({ status: WorkerStatus.BLOCKED }))).toBe(SWARM_BLOCKED_ROUTE);
    });

    it("re-delegates to the worker node when the worker is not blocked", () => {
        expect(
            routeAfterHuman(makeState({ status: WorkerStatus.WORKING, workerKind: WorkerKind.WEB_RESEARCHER })),
        ).toBe(SwarmNode.WEB_RESEARCHER);
    });

    it("re-delegates a done worker back to its worker node instead of compressing", () => {
        expect(routeAfterHuman(makeState({ status: WorkerStatus.DONE, workerKind: WorkerKind.INFRA_OPS }))).toBe(
            SwarmNode.INFRA_OPS,
        );
    });
});
