import type { ToolCapability, ToolName, ToolStatus, WorkerKind } from "../../consts";
import type { ToolArgs, ToolCallContext, JsonObject } from "./rpc.ts";

export type ToolAlias = ToolName;

export type QualifiedToolId = `${string}:${string}`;

export type SanitizedAction = { ok: true; alias: ToolAlias; args: ToolArgs } | { ok: false; error: string };

export type ToolResult = {
    readonly status: ToolStatus;
    readonly provider: string;
    readonly toolId: QualifiedToolId;
    readonly alias?: ToolAlias;
    readonly exitCode?: number;
    readonly details?: JsonObject;
    readonly content?: string;
    readonly raw?: JsonObject;
};

export type ToolDescriptor = {
    readonly id: QualifiedToolId;
    readonly aliases: readonly ToolAlias[];
    readonly capabilities: readonly ToolCapability[];
    /* Advisory only; the Brain-owned policy (WORKER_TOOLS) decides authorization, not the provider. */
    readonly suggestedKinds?: readonly WorkerKind[];
    readonly description: string;
    validate(args: ToolArgs): SanitizedAction;
    invoke(args: ToolArgs, context?: ToolCallContext): Promise<ToolResult>;
};

export type ToolProvider = {
    readonly name: string;
    readonly catalog: readonly ToolDescriptor[];
    /* True when this provider's tools route through the OpenClaw gateway (e.g. the
       gateway-backed web search), so the entry point must keep the gateway running
       even on an all-direct LLM profile. Absent/false = self-contained (local). */
    readonly requiresGateway?: boolean;
    start?(): Promise<void>;
    stop?(): Promise<void>;
};

export type ToolAccessPolicy = {
    allowedAliases(kind: WorkerKind, catalog: readonly ToolDescriptor[]): readonly ToolAlias[];
    renderCatalog(kind: WorkerKind, descriptors: readonly ToolDescriptor[]): string;
};

export type ToolRegistry = {
    invoke(alias: ToolAlias, args: ToolArgs, context?: ToolCallContext): Promise<ToolResult>;
    validate(kind: WorkerKind, alias: string, args: ToolArgs): SanitizedAction;
    allowedAliases(kind: WorkerKind): readonly ToolAlias[];
    renderCatalog(kind: WorkerKind): string;
    /* True when any registered provider routes through the OpenClaw gateway. */
    requiresGateway(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
};
