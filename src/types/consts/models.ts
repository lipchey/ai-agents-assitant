import { ModelRef as ModelRefValues, ModelRole as ModelRoleValues } from "../../consts/models.js";

export type ModelRef = (typeof ModelRefValues)[keyof typeof ModelRefValues];
export type ModelRole = (typeof ModelRoleValues)[keyof typeof ModelRoleValues];
