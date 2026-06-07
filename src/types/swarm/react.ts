import type { ReactDecisionKind } from "../../consts";
import type { ToolArgs, SanitizedAction } from "../tools";

export type ReactDecision =
    | { kind: typeof ReactDecisionKind.ACT; thought: string; tool: string; args: ToolArgs }
    | { kind: typeof ReactDecisionKind.FINAL; thought: string; final: string };

export type ReactStep = {
    thought: string;
    summary: string;
    observation: string;
    ok: boolean;
};

export type { SanitizedAction };
