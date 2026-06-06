import { ToolName as ToolNameValues, ToolStatus as ToolStatusValues } from "../../consts/tools.js";

export type ToolName = (typeof ToolNameValues)[keyof typeof ToolNameValues];
export type ToolStatus = (typeof ToolStatusValues)[keyof typeof ToolStatusValues];
