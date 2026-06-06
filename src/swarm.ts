// Public barrel for the Swarm execution sub-graph. The implementation lives in
// swarm/*; `humanGate`, `parseReactDecision`, and `sanitizeToolArgs` are exported
// for the smoke tests that pin the HITL channel and safety guards.
export { buildSwarm } from "./swarm/build.js";
export { humanGate } from "./swarm/nodes.js";
export { parseReactDecision, sanitizeToolArgs } from "./swarm/tool-validation.js";
