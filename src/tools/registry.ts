import { ToolErrorKind, isToolName, type WorkerKind } from "../consts";
import { errorMessage } from "../shared";
import type {
    QualifiedToolId,
    SanitizedAction,
    ToolAccessPolicy,
    ToolAlias,
    ToolArgs,
    ToolCallContext,
    ToolDescriptor,
    ToolProvider,
    ToolRegistry,
    ToolResult,
} from "../types/tools";
import { ToolError } from "./errors.ts";
import { DEFAULT_TOOL_BINDINGS } from "./bindings.ts";
import { createDefaultToolAccessPolicy } from "./policy.ts";
import { createLocalProvider, createWebProvider } from "./providers/index.ts";

type RegisteredDescriptor = {
    readonly provider: ToolProvider;
    readonly descriptor: ToolDescriptor;
};

export type CreateToolRegistryOptions = {
    readonly providers?: readonly ToolProvider[];
    readonly bindings?: Readonly<Record<ToolAlias, QualifiedToolId>>;
    readonly policy?: ToolAccessPolicy;
};

const classifyProviderError = (error: unknown): ToolErrorKind =>
    error instanceof ToolError ? error.kind : ToolErrorKind.EXECUTION;

class DefaultToolRegistry implements ToolRegistry {
    private readonly providers: readonly ToolProvider[];
    private readonly descriptors = new Map<QualifiedToolId, RegisteredDescriptor>();
    private readonly bindings: Readonly<Record<ToolAlias, QualifiedToolId>>;
    private readonly policy: ToolAccessPolicy;

    constructor(options?: CreateToolRegistryOptions) {
        this.providers = options?.providers ?? [createLocalProvider(), createWebProvider()];
        this.bindings = options?.bindings ?? DEFAULT_TOOL_BINDINGS;
        this.policy = options?.policy ?? createDefaultToolAccessPolicy();

        for (const provider of this.providers) {
            for (const descriptor of provider.catalog) {
                if (this.descriptors.has(descriptor.id)) {
                    throw new ToolError(
                        ToolErrorKind.VALIDATION,
                        `Duplicate tool descriptor id "${descriptor.id}" while registering provider "${provider.name}".`,
                        { provider: provider.name, toolId: descriptor.id },
                    );
                }
                this.descriptors.set(descriptor.id, { provider, descriptor });
            }
        }

        for (const [alias, id] of Object.entries(this.bindings) as Array<[ToolAlias, QualifiedToolId]>) {
            const registered = this.descriptors.get(id);
            if (!registered) {
                throw new ToolError(
                    ToolErrorKind.VALIDATION,
                    `Tool alias "${alias}" is bound to missing descriptor "${id}".`,
                    { toolId: id },
                );
            }
            if (!registered.descriptor.aliases.includes(alias)) {
                throw new ToolError(
                    ToolErrorKind.VALIDATION,
                    `Tool alias "${alias}" is bound to descriptor "${id}", but that descriptor does not advertise the alias.`,
                    { provider: registered.provider.name, toolId: id },
                );
            }
        }
    }

    /* Policy sees active bindings only, so prompt catalogs match the descriptor invoke() will route to. */
    private policyCatalog(): readonly ToolDescriptor[] {
        return (Object.entries(this.bindings) as Array<[ToolAlias, QualifiedToolId]>).map(([alias, id]) => {
            const registered = this.descriptors.get(id);
            if (!registered) {
                throw new ToolError(
                    ToolErrorKind.VALIDATION,
                    `Tool alias "${alias}" is bound to missing descriptor "${id}".`,
                    {
                        toolId: id,
                    },
                );
            }
            return { ...registered.descriptor, aliases: [alias] };
        });
    }

    private resolve(alias: ToolAlias): RegisteredDescriptor {
        const id = this.bindings[alias];
        const registered = this.descriptors.get(id);
        if (!registered) {
            throw new ToolError(
                ToolErrorKind.VALIDATION,
                `Tool alias "${alias}" is not bound to a registered descriptor.`,
                {
                    toolId: id,
                },
            );
        }
        return registered;
    }

    async invoke(alias: ToolAlias, args: ToolArgs, context?: ToolCallContext): Promise<ToolResult> {
        if (args.requireConfirmation) {
            throw new ToolError(
                ToolErrorKind.POLICY,
                `HITL_REQUIRED: confirmation required before executing ${alias}.`,
            );
        }

        const { provider, descriptor } = this.resolve(alias);
        try {
            const result = await descriptor.invoke(args, context);
            return result.alias ? result : { ...result, alias };
        } catch (error) {
            if (error instanceof ToolError) {
                throw error;
            }
            throw new ToolError(
                classifyProviderError(error),
                `Tool ${alias} via ${descriptor.id} failed: ${errorMessage(error)}`,
                { cause: error, provider: provider.name, toolId: descriptor.id },
            );
        }
    }

    validate(kind: WorkerKind, alias: string, args: ToolArgs): SanitizedAction {
        if (!isToolName(alias)) {
            return { ok: false, error: `Tool "${alias}" is not a known Brain alias.` };
        }

        const allowed = this.allowedAliases(kind);
        if (!allowed.includes(alias)) {
            return { ok: false, error: `Tool "${alias}" is not available to ${kind}. Allowed: ${allowed.join(", ")}.` };
        }

        return this.resolve(alias).descriptor.validate(args);
    }

    allowedAliases(kind: WorkerKind): readonly ToolAlias[] {
        return this.policy.allowedAliases(kind, this.policyCatalog());
    }

    renderCatalog(kind: WorkerKind): string {
        return this.policy.renderCatalog(kind, this.policyCatalog());
    }

    requiresGateway(): boolean {
        return this.providers.some((provider) => provider.requiresGateway === true);
    }

    async start(): Promise<void> {
        for (const provider of this.providers) {
            await provider.start?.();
        }
    }

    async stop(): Promise<void> {
        for (const provider of [...this.providers].reverse()) {
            await provider.stop?.();
        }
    }
}

let defaultToolRegistry: ToolRegistry | undefined;

export const createToolRegistry = (options?: CreateToolRegistryOptions): ToolRegistry =>
    new DefaultToolRegistry(options);

export const createDefaultToolRegistry = (): ToolRegistry => createToolRegistry();

export const getDefaultToolRegistry = (): ToolRegistry => {
    defaultToolRegistry ??= createDefaultToolRegistry();
    return defaultToolRegistry;
};
