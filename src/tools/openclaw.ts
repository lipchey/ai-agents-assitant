import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export class OpenClawError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OpenClawError";
    }
}

export const startOpenClawGateway = async (): Promise<void> => {
    // OpenClaw is assumed to be running externally.
    // We can do a quick probe to ensure it's up.
    try {
        const response = await fetch("http://127.0.0.1:18789/v1/models", {
            headers: {
                "Authorization": `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN || "dev_token_123"}`
            }
        });
        if (!response.ok) {
            console.warn("OpenClaw HTTP endpoint is reachable but returned non-OK status. It might not be fully ready.");
        }
    } catch (e: any) {
        throw new OpenClawError(`OpenClaw Gateway is not reachable at http://127.0.0.1:18789: ${e.message}`);
    }
};

export const stopOpenClawGateway = () => {
    // No-op since we don't manage the process
};

export const callLlm = async (
    modelKey: string,
    system: string,
    user: string
): Promise<{ content: string; tokens: number; cost: number }> => {
    const messages = [new SystemMessage(system), new HumanMessage(user)];
    
    // Read dynamic pricing
    let pricingData: any = {};
    try {
        const pricingFile = await fs.readFile(path.join(process.cwd(), "src/pricing.json"), "utf8");
        pricingData = JSON.parse(pricingFile);
    } catch (e) {
        console.warn("Could not read pricing.json, using fallback prices.");
    }

    try {
        let modelName = "";
        let temperature = 0.2;

        if (modelKey === "architect" || modelKey === "sme") {
            modelName = "claude-4-8-opus-20260528";
        } else if (modelKey === "coder") {
            modelName = "claude-4-6-sonnet-2026";
        } else if (modelKey === "critic") {
            modelName = "gpt-5.5";
            temperature = 0.1;
        } else {
            modelName = "deepseek-chat";
        }

        // Use OpenAI-compatible Chat Completions from OpenClaw
        const model = new ChatOpenAI({
            modelName: "openclaw/default",
            temperature,
            openAIApiKey: process.env.OPENCLAW_GATEWAY_TOKEN || "dev_token_123",
            configuration: {
                baseURL: "http://127.0.0.1:18789/v1",
                defaultHeaders: {
                    "x-openclaw-model": modelName
                }
            }
        });

        const response = await model.invoke(messages);
        
        // Extract usage
        const usage: any = response.usage_metadata || response.response_metadata?.tokenUsage || { input_tokens: 0, output_tokens: 0 };
        const inputTokens = usage.input_tokens || usage.promptTokens || 0;
        const outputTokens = usage.output_tokens || usage.completionTokens || 0;
        const totalTokens = usage.total_tokens || usage.totalTokens || (inputTokens + outputTokens);

        // Compute Cost
        let cost = 0;
        const modelPricing = pricingData[modelName];
        if (modelPricing) {
            cost = (inputTokens / 1_000_000) * modelPricing.inputPer1M + (outputTokens / 1_000_000) * modelPricing.outputPer1M;
        }

        return { content: response.content.toString(), tokens: totalTokens, cost };
    } catch (e: any) {
        return { content: `[LLM Error for ${modelKey}: ${e.message}]`, tokens: 0, cost: 0 };
    }
};

export const openclawRpc = async (
    tool: string,
    args: Record<string, any>,
    options?: { timeoutS?: number; idempotencyKey?: string; maxRetries?: number }
): Promise<Record<string, any>> => {
    if (args.requireConfirmation) {
        throw new OpenClawError(`HITL_REQUIRED: The LLM requested confirmation for tool execution: ${tool}`);
    }

    let method = tool;
    let openclawArgs: any = args;

    // Remap our internal tool names to standard gateway tools if needed
    if (tool === "shell_exec" || tool === "run_tests") {
        method = "system.run";
        openclawArgs = { command: args.command || args.subtask };
    } else if (tool === "ast_read") {
        method = "system.read";
        openclawArgs = { path: args.path || args.subtask };
    } else if (tool === "web_lookup") {
        method = "browser.search";
        openclawArgs = { query: args.query || args.subtask };
    }

    const payload = {
        tool: method,
        args: openclawArgs,
        sessionKey: "main",
    };

    try {
        const response = await fetch("http://127.0.0.1:18789/tools/invoke", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN || "dev_token_123"}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout((options?.timeoutS || 30) * 1000)
        });

        const data = await response.json();
        
        if (!response.ok || !data.ok) {
            throw new OpenClawError(data.error?.message || JSON.stringify(data));
        }

        return data.result;
    } catch (e: any) {
        throw new OpenClawError(`Failed to invoke tool ${tool}: ${e.message}`);
    }
};

export const storeArtifact = async (blob: string): Promise<string> => {
    const artifactDir = path.join(process.cwd(), ".openclaw_artifacts");
    await fs.mkdir(artifactDir, { recursive: true });
    
    const hash = crypto.createHash("sha256").update(blob).digest("hex").slice(0, 8);
    const fileName = `artifact-${Date.now()}-${hash}.txt`;
    const filePath = path.join(artifactDir, fileName);
    
    await fs.writeFile(filePath, blob, "utf-8");
    return `artifact://${fileName}`;
};
