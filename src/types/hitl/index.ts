import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import type {
    FailureType,
    HITL_THREAD_CONFIG_KEY,
    HitlInterruptKind,
    HitlResolutionAction,
    WorkerKind,
} from "../../consts";

export type HitlInterruptPayload = {
    kind: typeof HitlInterruptKind.ENVIRONMENT_FAILURE;
    failureType: FailureType;
    workerKind: WorkerKind;
    subtask: string;
    reason: string;
    escalationAttempt: number;
};

export type HitlResolution =
    | { action: typeof HitlResolutionAction.RETRY; guidance: string }
    | { action: typeof HitlResolutionAction.ABORT; guidance?: string };

export type HitlResolver = (request: HitlInterruptPayload) => Promise<HitlResolution>;

export type HitlGraphRunConfig = { configurable: { [HITL_THREAD_CONFIG_KEY]: string }; recursionLimit?: number };

export interface HitlDrivableGraph<TInput, TState> {
    invoke(input: TInput | Command, config: HitlGraphRunConfig): Promise<TState>;
}

export type HitlConfig = LangGraphRunnableConfig;
