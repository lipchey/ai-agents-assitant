// Shared alias for the main graph's resolved state value, used by every node and
// router so the `typeof GraphState.State` expression is written once.
import { GraphState } from "../state/graph-state.js";

export type GraphStateValue = typeof GraphState.State;
