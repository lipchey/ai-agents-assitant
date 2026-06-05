export class OpenClawError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OpenClawError";
    }
}

export const callLlm = async (modelKey: string, system: string, user: string): Promise<string> => {
    // STUB: Wire to ChatAnthropic / ChatOpenAI
    return `[Stub response from ${modelKey}]`;
};

export const openclawRpc = async (
    tool: string,
    args: Record<string, any>,
    options?: { timeoutS?: number; idempotencyKey?: string }
): Promise<Record<string, any>> => {
    // STUB RPC to the OpenClaw gateway. 
    return { raw: `[Stub output for tool ${tool}]` };
};

export const storeArtifact = async (blob: string): Promise<string> => {
    // STUB. Persist raw output, return a handle.
    return `artifact://${Date.now()}`;
};
