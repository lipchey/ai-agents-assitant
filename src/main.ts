import { END, START, StateGraph } from "@langchain/langgraph";
import { GraphState } from "./state.js";
import { callLlm, openclawRpc } from "./tools/openclaw.js";
import { buildSwarm } from "./swarm.js";

const MAX_DEBATE_ITERATIONS = 4;
const ARCHITECT_COST = 5;
const CRITIC_COST = 4;
const SME_COST = 6;

// Nodes
const complexityRouter = async (state: typeof GraphState.State) => {
    const { content, cost, tokens } = await callLlm("router", "Classify task complexity.", state.originalTask);
    return {
        complexity: "tool_complex" as any, // stub
        routeConfidence: 0.9,
        tokenBudget: state.tokenBudget || 50,
        debateIterations: 0,
        consensusReached: false,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "router": { cost, tokens } }
    };
};

const firewall = async (state: typeof GraphState.State) => {
    return { compressedContext: "<<aggregated structured summary>>" };
};

const claudeArchitect = async (state: typeof GraphState.State) => {
    const { content, cost, tokens } = await callLlm("architect", "Architect. Write a technical specification.", `${state.originalTask}\n${state.compressedContext}\n${state.verificationReport || ""}`);
    return {
        architectureSpec: content,
        tokenBudget: state.tokenBudget - ARCHITECT_COST,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "architect": { cost, tokens } }
    };
};

const claudeCoder = async (state: typeof GraphState.State) => {
    const { content, cost, tokens } = await callLlm("coder", "Coder. Write code based on spec.", `Spec:\n${state.architectureSpec}\n\nCritiques to fix:\n${state.debateSummary || "None"}`);
    return {
        currentDraft: content,
        tokenBudget: state.tokenBudget - 3, // Assuming Coder cost is 3
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "coder": { cost, tokens } }
    };
};

const openaiCritic = async (state: typeof GraphState.State) => {
    const { content, cost, tokens } = await callLlm("critic", "Critique, do not rewrite.", state.currentDraft);
    const consensus = content.includes("LGTM");
    return {
        debateThread: [{ round: state.debateIterations, critique: content }],
        debateSummary: "<<rolling windowed summary>>",
        debateIterations: state.debateIterations + 1,
        consensusReached: consensus,
        needsMoreContext: false,
        tokenBudget: state.tokenBudget - CRITIC_COST,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "critic": { cost, tokens } }
    };
};

const smeTiebreaker = async (state: typeof GraphState.State) => {
    const { content, cost, tokens } = await callLlm("sme", "Make the final call.", `${state.currentDraft}\n${state.debateSummary}`);
    return {
        currentDraft: content,
        consensusReached: true,
        tokenBudget: state.tokenBudget - SME_COST,
        totalCost: cost,
        totalTokens: tokens,
        usageStats: { "sme": { cost, tokens } }
    };
};

const verify = async (state: typeof GraphState.State) => {
    const report = await openclawRpc("run_tests", { draft: state.currentDraft });
    const passed = report.passed || false;
    const out: Partial<typeof GraphState.State> = {
        verificationPassed: passed,
        verificationReport: JSON.stringify(report),
    };
    if (passed) {
        out.bestDraft = state.currentDraft;
    }
    return out;
};

const finalize = async (state: typeof GraphState.State) => {
    const answer = state.bestDraft || state.currentDraft || "";
    return { finalAnswer: answer };
};

// Routing
const routeByComplexity = (state: typeof GraphState.State): string => {
    const c = state.complexity;
    if (c === "trivial") return "finalize";
    if (c === "pure_reasoning") return "claudeArchitect";
    return "swarm";
};

const routeDebate = (state: typeof GraphState.State): string => {
    if ((state.tokenBudget || 0) <= 0) return "verify";
    if (state.needsMoreContext) return "swarm";
    if (state.consensusReached) return "verify";
    if (state.debateIterations >= MAX_DEBATE_ITERATIONS) return "smeTiebreaker";
    return "claudeCoder"; // Loop back to the Coder on rejection
};

const routeAfterVerify = (state: typeof GraphState.State): string => {
    if (state.verificationPassed || (state.tokenBudget || 0) <= 0) return "finalize";
    return "claudeCoder"; // Failures in verification go to Coder
};

// Assembly
export const buildMainGraph = () => {
    const swarm = buildSwarm();
    const g = new StateGraph(GraphState)
        .addNode("complexityRouter", complexityRouter)
        .addNode("swarm", swarm as any) // langgraph sub-graph mapping handling
        .addNode("firewall", firewall)
        .addNode("claudeArchitect", claudeArchitect)
        .addNode("claudeCoder", claudeCoder)
        .addNode("openaiCritic", openaiCritic)
        .addNode("smeTiebreaker", smeTiebreaker)
        .addNode("verify", verify)
        .addNode("finalize", finalize)
        .addEdge(START, "complexityRouter")
        .addConditionalEdges("complexityRouter", routeByComplexity, {
            "finalize": "finalize",
            "swarm": "swarm",
            "claudeArchitect": "claudeArchitect"
        })
        .addEdge("swarm", "firewall")
        .addEdge("firewall", "claudeArchitect")
        .addEdge("claudeArchitect", "claudeCoder")
        .addEdge("claudeCoder", "openaiCritic")
        .addConditionalEdges("openaiCritic", routeDebate, {
            "claudeCoder": "claudeCoder",
            "swarm": "swarm",
            "smeTiebreaker": "smeTiebreaker",
            "verify": "verify"
        })
        .addEdge("smeTiebreaker", "verify")
        .addConditionalEdges("verify", routeAfterVerify, {
            "finalize": "finalize",
            "claudeCoder": "claudeCoder"
        })
        .addEdge("finalize", END);

    return g.compile();
};
