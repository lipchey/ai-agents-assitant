import { ReactDecisionKind } from "../../consts";
import type { OpenClawRpcArgs } from "../tools";

export type ReactDecision =
    | { kind: typeof ReactDecisionKind.ACT; thought: string; tool: string; args: OpenClawRpcArgs }
    | { kind: typeof ReactDecisionKind.FINAL; thought: string; final: string };

export type ReactStep = {
    thought: string;
    summary: string;
    observation: string;
    ok: boolean;
};

export type SanitizedAction =
    | { ok: true; args: OpenClawRpcArgs }
    | { ok: false; error: string };
