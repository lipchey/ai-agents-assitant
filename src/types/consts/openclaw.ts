import { OpenClawControl as OpenClawControlValues } from "../../consts/openclaw.js";

export type OpenClawControl = (typeof OpenClawControlValues)[keyof typeof OpenClawControlValues];
