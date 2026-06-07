import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { TOOL_REGISTRY_CONFIG_KEY } from "../consts";
import type { ToolRegistry } from "../types/tools";
import { getDefaultToolRegistry } from "./registry.ts";

const isToolRegistry = (value: unknown): value is ToolRegistry =>
    Boolean(value)
    && typeof value === "object"
    && typeof (value as { invoke?: unknown }).invoke === "function"
    && typeof (value as { validate?: unknown }).validate === "function"
    && typeof (value as { renderCatalog?: unknown }).renderCatalog === "function";

export const readToolRegistry = (config?: LangGraphRunnableConfig): ToolRegistry => {
    const registry = config?.configurable?.[TOOL_REGISTRY_CONFIG_KEY];
    return isToolRegistry(registry) ? registry : getDefaultToolRegistry();
};
