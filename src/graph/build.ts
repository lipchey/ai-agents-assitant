import { END, START, StateGraph } from "@langchain/langgraph";
import { MainNode } from "../consts/graph.ts";
import { GraphState } from "../state/graph-state.ts";
import { applyPatches } from "./nodes/apply-patches.ts";
import { claudeArchitect, frontierArchitect } from "./nodes/architects.ts";
import { claudeCoder } from "./nodes/coder.ts";
import { frontierCritic, openaiCritic } from "./nodes/critics.ts";
import { directResponder } from "./nodes/direct.ts";
import { finalize } from "./nodes/finalize.ts";
import { firewall, swarmNode } from "./nodes/swarm-node.ts";
import { complexityRouter } from "./nodes/router.ts";
import { smeTiebreaker } from "./nodes/tiebreaker.ts";
import { verify } from "./nodes/verify.ts";
import {
    routeAfterApplyPatches,
    routeAfterClaudeArchitect,
    routeAfterCoder,
    routeAfterFrontierArchitect,
    routeAfterFrontierCritic,
    routeAfterVerify,
    routeByComplexity,
    routeDebate,
} from "./routing.ts";

export const buildMainGraph = () => {
    return new StateGraph(GraphState)
        .addNode(MainNode.COMPLEXITY_ROUTER, complexityRouter)
        .addNode(MainNode.DIRECT_RESPONDER, directResponder)
        .addNode(MainNode.SWARM, swarmNode)
        .addNode(MainNode.FIREWALL, firewall)
        .addNode(MainNode.FRONTIER_ARCHITECT, frontierArchitect)
        .addNode(MainNode.CLAUDE_ARCHITECT, claudeArchitect)
        .addNode(MainNode.CLAUDE_CODER, claudeCoder)
        .addNode(MainNode.FRONTIER_CRITIC, frontierCritic)
        .addNode(MainNode.OPENAI_CRITIC, openaiCritic)
        .addNode(MainNode.SME_TIEBREAKER, smeTiebreaker)
        .addNode(MainNode.APPLY_PATCHES, applyPatches)
        .addNode(MainNode.VERIFY, verify)
        .addNode(MainNode.FINALIZE, finalize)
        .addEdge(START, MainNode.COMPLEXITY_ROUTER)
        .addConditionalEdges(MainNode.COMPLEXITY_ROUTER, routeByComplexity, {
            [MainNode.DIRECT_RESPONDER]: MainNode.DIRECT_RESPONDER,
            [MainNode.SWARM]: MainNode.SWARM,
            [MainNode.FRONTIER_ARCHITECT]: MainNode.FRONTIER_ARCHITECT,
        })
        .addEdge(MainNode.DIRECT_RESPONDER, MainNode.FINALIZE)
        .addEdge(MainNode.SWARM, MainNode.FIREWALL)
        .addEdge(MainNode.FIREWALL, MainNode.FRONTIER_ARCHITECT)
        .addConditionalEdges(MainNode.FRONTIER_ARCHITECT, routeAfterFrontierArchitect, {
            [MainNode.CLAUDE_ARCHITECT]: MainNode.CLAUDE_ARCHITECT,
            [MainNode.CLAUDE_CODER]: MainNode.CLAUDE_CODER,
            [MainNode.FINALIZE]: MainNode.FINALIZE,
        })
        .addConditionalEdges(MainNode.CLAUDE_ARCHITECT, routeAfterClaudeArchitect, {
            [MainNode.CLAUDE_CODER]: MainNode.CLAUDE_CODER,
            [MainNode.FINALIZE]: MainNode.FINALIZE,
        })
        .addConditionalEdges(MainNode.CLAUDE_CODER, routeAfterCoder, {
            [MainNode.FRONTIER_CRITIC]: MainNode.FRONTIER_CRITIC,
            [MainNode.APPLY_PATCHES]: MainNode.APPLY_PATCHES,
        })
        .addConditionalEdges(MainNode.FRONTIER_CRITIC, routeAfterFrontierCritic, {
            [MainNode.CLAUDE_CODER]: MainNode.CLAUDE_CODER,
            [MainNode.SWARM]: MainNode.SWARM,
            [MainNode.SME_TIEBREAKER]: MainNode.SME_TIEBREAKER,
            [MainNode.APPLY_PATCHES]: MainNode.APPLY_PATCHES,
            [MainNode.OPENAI_CRITIC]: MainNode.OPENAI_CRITIC,
        })
        .addConditionalEdges(MainNode.OPENAI_CRITIC, routeDebate, {
            [MainNode.CLAUDE_CODER]: MainNode.CLAUDE_CODER,
            [MainNode.SWARM]: MainNode.SWARM,
            [MainNode.SME_TIEBREAKER]: MainNode.SME_TIEBREAKER,
            [MainNode.APPLY_PATCHES]: MainNode.APPLY_PATCHES,
        })
        .addEdge(MainNode.SME_TIEBREAKER, MainNode.APPLY_PATCHES)
        .addConditionalEdges(MainNode.APPLY_PATCHES, routeAfterApplyPatches, {
            [MainNode.VERIFY]: MainNode.VERIFY,
            [MainNode.CLAUDE_CODER]: MainNode.CLAUDE_CODER,
            [MainNode.FINALIZE]: MainNode.FINALIZE,
        })
        .addConditionalEdges(MainNode.VERIFY, routeAfterVerify, {
            [MainNode.FINALIZE]: MainNode.FINALIZE,
            [MainNode.CLAUDE_CODER]: MainNode.CLAUDE_CODER,
        })
        .addEdge(MainNode.FINALIZE, END)
        .compile();
};
