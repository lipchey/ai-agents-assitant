import { ToolProviderName } from "../../../consts";
import type { ToolProvider } from "../../../types/tools";
import { webDescriptors } from "./descriptors.ts";

export const createWebProvider = (): ToolProvider => ({
    name: ToolProviderName.WEB,
    catalog: webDescriptors,
});
