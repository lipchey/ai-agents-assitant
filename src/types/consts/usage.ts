import { UsageKey as UsageKeyValues } from "../../consts/usage.js";

export type UsageKey = (typeof UsageKeyValues)[keyof typeof UsageKeyValues];
