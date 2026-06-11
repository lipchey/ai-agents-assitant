import { ToolProviderName } from "../../../consts";
import type { ToolProvider } from "../../../types/tools";
import { webDescriptors } from "./descriptors.ts";

export const createWebProvider = (): ToolProvider => ({
    name: ToolProviderName.WEB,
    /* web_lookup runs over the OpenClaw gateway (Tavily/DuckDuckGo via invokeGatewayTool),
       so the gateway is required even when every LLM binding uses the direct transport. */
    requiresGateway: true,
    catalog: webDescriptors,
});
