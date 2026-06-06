import { MainNode as MainNodeValues, SwarmNode as SwarmNodeValues } from "../../consts/graph.js";

export type MainNode = (typeof MainNodeValues)[keyof typeof MainNodeValues];
export type SwarmNode = (typeof SwarmNodeValues)[keyof typeof SwarmNodeValues];
