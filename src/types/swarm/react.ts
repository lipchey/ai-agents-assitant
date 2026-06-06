import type { OpenClawRpcArgs } from "../tools/rpc.ts";

export type ReactDecision =
    | { kind: "act"; thought: string; tool: string; args: OpenClawRpcArgs }
    | { kind: "final"; thought: string; final: string };

export type ReactStep = {
    thought: string;
    summary: string;
    observation: string;
    ok: boolean;
};

export type SanitizedAction =
    | { ok: true; args: OpenClawRpcArgs }
    | { ok: false; error: string };
