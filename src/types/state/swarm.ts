export type ToolCallRecord = {
    tool: string;
    ok: boolean;
    artifact?: string;
    error?: string;
};
