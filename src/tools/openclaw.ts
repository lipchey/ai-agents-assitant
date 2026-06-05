import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const execAsync = promisify(exec);

export class OpenClawError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OpenClawError";
    }
}

// In-memory cache for idempotency
const idempotencyCache = new Map<string, any>();

// Helper for timeout
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs))
    ]);
};

// Tool implementations
const handlers: Record<string, (args: any) => Promise<any>> = {
    "ast_read": async (args: any) => {
        const filepath = args.path || args.subtask;
        if (!filepath) throw new OpenClawError("ast_read requires 'path'");
        try {
            const content = await fs.readFile(filepath, "utf-8");
            return { raw: content };
        } catch (e: any) {
            throw new OpenClawError(`ast_read failed: ${e.message}`);
        }
    },
    "shell_exec": async (args: any) => {
        const command = args.command || args.subtask;
        if (!command) throw new OpenClawError("shell_exec requires 'command'");
        
        // DeepSeek / LLM decides if HITL is required via parameter
        if (args.requireConfirmation) {
            throw new OpenClawError(`HITL_REQUIRED: The LLM requested confirmation for command: ${command}`);
        }
        
        try {
            const { stdout, stderr } = await execAsync(command);
            return { raw: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` };
        } catch (e: any) {
            return { raw: `EXEC_ERROR:\n${e.message}\nSTDOUT:\n${e.stdout}\nSTDERR:\n${e.stderr}` };
        }
    },
    "run_tests": async (args: any) => {
        const testCommand = args.command || "npm test";
        try {
            const { stdout, stderr } = await execAsync(testCommand);
            return { raw: `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`, passed: true };
        } catch (e: any) {
            return { raw: `TEST_ERROR:\n${e.message}`, passed: false };
        }
    },
    "web_lookup": async (args: any) => {
        const query = args.query || args.subtask;
        if (!query) throw new OpenClawError("web_lookup requires 'query'");

        const cx = process.env.GOOGLE_SEARCH_CX;
        const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
        
        // Generic placeholder if Google credentials are missing
        if (!cx || !apiKey) {
            return { raw: `[Mock Google Search Result for: ${query}]` };
        }
        
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&cx=${cx}&key=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Google Search API error: ${response.statusText}`);
        }
        const data = await response.json();
        const results = data.items?.map((item: any) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet
        })) || [];
        return { raw: JSON.stringify(results, null, 2) };
    }
};

export const callLlm = async (modelKey: string, system: string, user: string): Promise<string> => {
    // STUB: Wire to ChatAnthropic / ChatOpenAI
    return `[Stub response from ${modelKey}]`;
};

export const openclawRpc = async (
    tool: string,
    args: Record<string, any>,
    options?: { timeoutS?: number; idempotencyKey?: string; maxRetries?: number }
): Promise<Record<string, any>> => {
    const { timeoutS = 30, idempotencyKey, maxRetries = 2 } = options || {};

    if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
        return idempotencyCache.get(idempotencyKey);
    }

    const handler = handlers[tool];
    if (!handler) {
        throw new OpenClawError(`Tool ${tool} not found in OpenClaw module.`);
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
        try {
            const result = await withTimeout(handler(args), timeoutS * 1000);
            
            if (idempotencyKey) {
                idempotencyCache.set(idempotencyKey, result);
            }
            return result;
        } catch (error: any) {
            // Throw immediately if it's an explicit HITL request from the LLM
            if (error instanceof OpenClawError && error.message.includes("HITL_REQUIRED")) {
                throw error;
            }
            
            attempt++;
            if (attempt > maxRetries) {
                throw new OpenClawError(`Tool ${tool} failed after ${maxRetries} retries: ${error.message}`);
            }
            // Exponential backoff
            await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 1000));
        }
    }
    
    throw new OpenClawError("Unexpected error in openclawRpc.");
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
