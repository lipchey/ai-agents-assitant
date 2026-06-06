import { EnvVar as EnvVarValues } from "../../consts/env.js";

export type EnvVar = (typeof EnvVarValues)[keyof typeof EnvVarValues];
