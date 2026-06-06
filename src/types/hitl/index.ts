import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import type { FailureType, WorkerKind } from "../../consts";

export type HitlInterruptPayload = {
    kind: "environment_failure";
    failureType: FailureType;
    workerKind: WorkerKind;
    subtask: string;
    reason: string;
    escalationAttempt: number;
};

export type HitlResolution =
    | { action: "retry"; guidance: string }
    | { action: "abort"; guidance?: string };

export type HitlResolver = (request: HitlInterruptPayload) => Promise<HitlResolution>;

export type HitlGraphRunConfig = { configurable: { thread_id: string }; recursionLimit?: number };

export interface HitlDrivableGraph<TInput, TState> {
    invoke(input: TInput | Command, config: HitlGraphRunConfig): Promise<TState>;
}

export type HitlConfig = LangGraphRunnableConfig;
