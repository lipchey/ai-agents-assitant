export { buildMainGraph } from "./graph/build.ts";

export {
    autoAbortResolver,
    createStdinHitlResolver,
    driveSwarmWithHitl,
    HITL_RESOLVER_CONFIG_KEY,
    readHitlResolver,
} from "./hitl";
export type {
    HitlDrivableGraph,
    HitlGraphRunConfig,
    HitlInterruptPayload,
    HitlResolution,
    HitlResolver,
} from "./types/hitl";

export { applyPatchBlocks, parsePatchBlocks, rollbackPatches } from "./patching";
export type { ApplyPatchesResult, OriginalReadResult, PatchBlock } from "./types/patching";

export { SystemPrompts } from "./prompts";
export type { SystemPromptKey } from "./prompts";

export { GraphState } from "./state/graph-state.ts";
export { SwarmWorkerState } from "./state/swarm-state.ts";
export type { DebateEntry } from "./types/state/graph.ts";
export type { ToolCallRecord } from "./types/state/swarm.ts";
export type { UsageBreakdown, UsageStats } from "./types/usage.ts";

export { buildSwarm } from "./swarm/build.ts";
export { humanGate } from "./swarm/nodes.ts";
export { parseReactDecision, sanitizeToolArgs } from "./swarm/tool-validation.ts";
