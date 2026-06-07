import { ToolProviderName } from "../../../consts";
import type { ToolProvider } from "../../../types/tools";
import { localDescriptors } from "./descriptors.ts";

export const createLocalProvider = (): ToolProvider => ({
    name: ToolProviderName.LOCAL,
    catalog: localDescriptors,
});
