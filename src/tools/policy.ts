import { WORKER_TOOLS } from "../consts";
import type { ToolAccessPolicy } from "../types/tools";

export const createDefaultToolAccessPolicy = (): ToolAccessPolicy => {
    /* Single source of "what this worker may use": the role catalog intersected with what providers expose. */
    const allowedAliases: ToolAccessPolicy["allowedAliases"] = (kind, catalog) => {
        const available = new Set(catalog.flatMap((descriptor) => descriptor.aliases));
        return WORKER_TOOLS[kind].filter((alias) => available.has(alias));
    };

    return {
        allowedAliases,
        renderCatalog: (kind, descriptors) => {
            const describeFor = new Map(
                descriptors.flatMap((descriptor) =>
                    descriptor.aliases.map((alias) => [alias, descriptor.description] as const),
                ),
            );
            const lines = [...allowedAliases(kind, descriptors)]
                .sort((left, right) => left.localeCompare(right))
                .map((alias) => `- ${alias} ${describeFor.get(alias) ?? ""}`);

            return lines.length > 0 ? ["AVAILABLE TOOLS:", ...lines].join("\n") : "AVAILABLE TOOLS:\n(none)";
        },
    };
};
