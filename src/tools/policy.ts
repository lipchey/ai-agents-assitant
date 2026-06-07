import { WORKER_TOOLS } from "../consts";
import type { ToolAccessPolicy, ToolAlias, ToolDescriptor } from "../types/tools";

const descriptorAliases = (descriptor: ToolDescriptor): readonly ToolAlias[] => descriptor.aliases;

export const createDefaultToolAccessPolicy = (): ToolAccessPolicy => ({
    allowedAliases: (kind, catalog) => {
        const available = new Set(catalog.flatMap(descriptorAliases));
        return WORKER_TOOLS[kind].filter((alias) => available.has(alias));
    },
    renderCatalog: (kind, descriptors) => {
        const allowed = new Set(WORKER_TOOLS[kind]);
        const lines = descriptors
            .flatMap((descriptor) => descriptor.aliases.map((alias) => ({ alias, descriptor })))
            .filter(({ alias }) => allowed.has(alias))
            .sort((left, right) => left.alias.localeCompare(right.alias))
            .map(({ alias, descriptor }) => `- ${alias} ${descriptor.description}`);

        return lines.length > 0
            ? ["AVAILABLE TOOLS:", ...lines].join("\n")
            : "AVAILABLE TOOLS:\n(none)";
    },
});
