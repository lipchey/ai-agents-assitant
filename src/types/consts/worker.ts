import {
    FailureType as FailureTypeValues,
    WorkerKind as WorkerKindValues,
    WorkerStatus as WorkerStatusValues,
} from "../../consts/worker.js";

export type WorkerStatus = (typeof WorkerStatusValues)[keyof typeof WorkerStatusValues];
export type FailureType = (typeof FailureTypeValues)[keyof typeof FailureTypeValues];
export type WorkerKind = (typeof WorkerKindValues)[keyof typeof WorkerKindValues];
