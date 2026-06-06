/* Fresh swarm runs keep HITL checkpoints isolated between debate refetches. */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { WorkerStatus } from "../../consts/worker.js";
import { driveSwarmWithHitl, readHitlResolver, type HitlDrivableGraph } from "../../hitl.js";
import { buildSwarm } from "../../swarm.js";
import type { GraphStateValue } from "../../types/graph/state.js";
import type { SwarmWorkerStateValue } from "../../types/swarm/state.js";
import { buildSwarmSubtask, selectWorkerKind } from "../context-terms.js";

export const swarmNode = async (state: GraphStateValue, config?: LangGraphRunnableConfig) => {
    const swarm = buildSwarm();
    const subtask = buildSwarmSubtask(state);
    const initialInput = {
        subtask,
        workerKind: selectWorkerKind(subtask),
        status: WorkerStatus.PENDING,
        attempts: 0,
        escalationAttempts: 0,
    };
    const result = await driveSwarmWithHitl(
        swarm as HitlDrivableGraph<typeof initialInput, SwarmWorkerStateValue>,
        initialInput,
        readHitlResolver(config),
    );
    const fallbackSummary = [
        `Swarm finished with status: ${result.status ?? "unknown"}.`,
        result.escalationQuery ? `Escalation query: ${result.escalationQuery}` : "",
        result.rawToolOutput ? "Raw output was captured in artifacts." : "",
    ].filter(Boolean).join(" ");

    return {
        swarmSummary: result.workerSummary || result.rawToolOutput || fallbackSummary,
        swarmStatus: result.status,
        artifactIndex: result.producedArtifacts,
        contextFetches: (state.contextFetches ?? 0) + 1,
        totalCost: result.totalCost,
        totalTokens: result.totalTokens,
        usageStats: result.usageStats,
    };
};

export const firewall = async (state: GraphStateValue) => {
    const compressedContext = state.swarmSummary
        ? state.swarmSummary
        : JSON.stringify({ note: "No execution context was gathered.", artifacts: state.artifactIndex });
    return { compressedContext };
};
