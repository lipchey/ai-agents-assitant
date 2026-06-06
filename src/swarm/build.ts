/* humanGate interrupt requires a checkpointer; each swarm run gets an isolated saver. */
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { SWARM_BLOCKED_ROUTE, SwarmNode, WORKER_ROUTES } from "../consts";
import { SwarmWorkerState } from "../state";
import { blocked, codeExplorer, humanGate, infraOps, leadDelegator, smeOracle, webResearcher, workerCompress } from "./nodes.ts";
import { delegateToWorker, routeAfterHuman, routeAfterSme, routeAfterWorker } from "./routing.ts";

export const buildSwarm = () => {
    const graph = new StateGraph(SwarmWorkerState)
        .addNode(SwarmNode.LEAD_DELEGATOR, leadDelegator)
        .addNode(SwarmNode.CODE_EXPLORER, codeExplorer)
        .addNode(SwarmNode.INFRA_OPS, infraOps)
        .addNode(SwarmNode.WEB_RESEARCHER, webResearcher)
        .addNode(SwarmNode.SME_ORACLE, smeOracle)
        .addNode(SwarmNode.HUMAN_GATE, humanGate)
        .addNode(SwarmNode.WORKER_COMPRESS, workerCompress)
        .addNode(SwarmNode.BLOCKED, blocked)
        .addEdge(START, SwarmNode.LEAD_DELEGATOR)
        .addConditionalEdges(SwarmNode.LEAD_DELEGATOR, delegateToWorker, WORKER_ROUTES);

    const afterWorkerTargets = {
        [SwarmNode.SME_ORACLE]: SwarmNode.SME_ORACLE,
        [SwarmNode.HUMAN_GATE]: SwarmNode.HUMAN_GATE,
        [SwarmNode.WORKER_COMPRESS]: SwarmNode.WORKER_COMPRESS,
        [SWARM_BLOCKED_ROUTE]: SwarmNode.BLOCKED,
    } as const;

    graph
        .addConditionalEdges(SwarmNode.CODE_EXPLORER, routeAfterWorker, afterWorkerTargets)
        .addConditionalEdges(SwarmNode.INFRA_OPS, routeAfterWorker, afterWorkerTargets)
        .addConditionalEdges(SwarmNode.WEB_RESEARCHER, routeAfterWorker, afterWorkerTargets);

    const recoveryTargets = {
        ...WORKER_ROUTES,
        [SWARM_BLOCKED_ROUTE]: SwarmNode.BLOCKED,
    } as const;

    graph
        .addConditionalEdges(SwarmNode.SME_ORACLE, routeAfterSme, recoveryTargets)
        .addConditionalEdges(SwarmNode.HUMAN_GATE, routeAfterHuman, recoveryTargets)
        .addEdge(SwarmNode.WORKER_COMPRESS, END)
        .addEdge(SwarmNode.BLOCKED, END);

    return graph.compile({ checkpointer: new MemorySaver() });
};
