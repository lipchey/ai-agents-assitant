import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import assert from "node:assert/strict";
import { FailureType, WorkerKind, WorkerStatus } from "../src/consts/worker.ts";
import {
    autoAbortResolver,
    driveSwarmWithHitl,
    type HitlDrivableGraph,
    type HitlInterruptPayload,
    type HitlResolver,
} from "../src/hitl.ts";
import { SwarmWorkerState } from "../src/state.ts";
import { humanGate } from "../src/swarm.ts";

type WorkerState = typeof SwarmWorkerState.State;

/* Mirrors a missing-binary failure the model cannot fix without HITL guidance. */
const fakeWorker = (state: WorkerState) => {
    if (state.escalationResponse) {
        return {
            status: WorkerStatus.DONE,
            failureType: FailureType.NONE,
            workerSummary: `recovered via human guidance: ${state.escalationResponse}`,
        };
    }
    return {
        status: WorkerStatus.ESCALATING,
        failureType: FailureType.ENVIRONMENT,
        escalationQuery: "rg: command not found",
        attempts: (state.attempts ?? 0) + 1,
    };
};

const afterWorker = (state: WorkerState): string =>
    state.status === WorkerStatus.DONE ? "end" : "humanGate";
const afterHuman = (state: WorkerState): string =>
    state.status === WorkerStatus.BLOCKED ? "end" : "worker";

const buildTestGraph = () =>
    new StateGraph(SwarmWorkerState)
        .addNode("worker", fakeWorker)
        .addNode("humanGate", humanGate)
        .addEdge(START, "worker")
        .addConditionalEdges("worker", afterWorker, { humanGate: "humanGate", end: END })
        .addConditionalEdges("humanGate", afterHuman, { worker: "worker", end: END })
        .compile({ checkpointer: new MemorySaver() });

const initialInput = {
    subtask: "inspect repository",
    workerKind: WorkerKind.CODE_EXPLORER,
    status: WorkerStatus.PENDING,
    attempts: 0,
    escalationAttempts: 0,
};

const asDrivable = (graph: ReturnType<typeof buildTestGraph>) =>
    graph as HitlDrivableGraph<typeof initialInput, WorkerState>;

const run = async (): Promise<void> => {
    const abortState = await driveSwarmWithHitl(
        asDrivable(buildTestGraph()),
        initialInput,
        autoAbortResolver,
        { threadId: "smoke-abort" },
    );
    assert.equal(abortState.status, WorkerStatus.BLOCKED, "auto-abort must block gracefully");
    assert.match(abortState.escalationResponse ?? "", /command not found/u, "block must surface the failure detail");
    console.log("PASS: auto-abort → BLOCKED with failure detail propagated");

    let captured: HitlInterruptPayload | undefined;
    const retryResolver: HitlResolver = async (request) => {
        captured = request;
        return { action: "retry", guidance: "installed ripgrep; please retry" };
    };
    const retryState = await driveSwarmWithHitl(
        asDrivable(buildTestGraph()),
        initialInput,
        retryResolver,
        { threadId: "smoke-retry" },
    );
    assert.ok(captured, "resolver must receive the interrupt payload");
    assert.equal(captured?.kind, "environment_failure");
    assert.equal(captured?.failureType, FailureType.ENVIRONMENT);
    assert.equal(captured?.workerKind, WorkerKind.CODE_EXPLORER);
    assert.match(captured?.reason ?? "", /command not found/u);
    assert.equal(retryState.status, WorkerStatus.DONE, "retry must let the worker recover");
    assert.match(retryState.workerSummary ?? "", /installed ripgrep/u, "human guidance must reach the worker");
    console.log("PASS: retry → interrupt surfaced, guidance threaded, worker recovered (DONE)");

    console.log("\nHITL smoke test passed.");
};

void run().catch((error) => {
    console.error("HITL smoke test FAILED:", error);
    process.exitCode = 1;
});
