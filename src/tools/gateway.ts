import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
    DEFAULT_GATEWAY_URL,
    EnvVar,
    GATEWAY_LOG_MAX_CHARS,
    GATEWAY_PROBE_TIMEOUT_MS,
    GATEWAY_SHUTDOWN_GRACE_MS,
    GATEWAY_STARTUP_POLL_INTERVAL_MS,
    OpenClawControl,
    STARTUP_TIMEOUT_MS,
} from "../consts";
import { OpenClawError } from "./errors.ts";

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let managedGatewayProcess: ChildProcess | null = null;
let managedGatewayLog = "";

const appendGatewayLog = (chunk: Buffer): void => {
    managedGatewayLog = `${managedGatewayLog}${chunk.toString("utf8")}`.slice(-GATEWAY_LOG_MAX_CHARS);
};

export const getGatewayBaseUrl = (): string => {
    const configured = process.env[EnvVar.GATEWAY_URL] ?? process.env[EnvVar.BASE_URL] ?? DEFAULT_GATEWAY_URL;
    return configured
        .replace(/^ws:/u, "http:")
        .replace(/^wss:/u, "https:")
        .replace(/\/+$/u, "");
};

export const getGatewayToken = (): string => {
    const token = process.env[EnvVar.GATEWAY_TOKEN];
    if (!token) {
        throw new OpenClawError(
            `${EnvVar.GATEWAY_TOKEN} is not set. Provide the gateway token via the environment (e.g. in .env) before contacting the gateway.`,
        );
    }
    return token;
};

export const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${getGatewayToken()}`,
});

const getOpenClawConfigPath = (): string =>
    process.env[EnvVar.CONFIG_PATH] ?? path.join(process.cwd(), "openclaw.config.json5");

const getOpenClawStateDir = (): string =>
    process.env[EnvVar.STATE_DIR] ?? path.join(process.cwd(), ".openclaw_state");

const probeGateway = async (timeoutMs = GATEWAY_PROBE_TIMEOUT_MS): Promise<boolean> => {
    const baseUrl = getGatewayBaseUrl();
    const probeUrls = [
        `${baseUrl}${OpenClawControl.READY_ENDPOINT}`,
        `${baseUrl}${OpenClawControl.HEALTH_ENDPOINT}`,
        `${baseUrl}${OpenClawControl.MODELS_ENDPOINT}`,
    ];

    for (const url of probeUrls) {
        try {
            const response = await fetch(url, {
                headers: authHeaders(),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok) {
                return true;
            }
        } catch {
            /* Try every probe endpoint before declaring the gateway unavailable. */
        }
    }

    return false;
};

const resolveGatewayPort = (): string => {
    const parsed = new URL(getGatewayBaseUrl());
    if (parsed.port) {
        return parsed.port;
    }
    return parsed.protocol === "https:" ? "443" : "80";
};

const resolveOpenClawCli = async (): Promise<{ command: string; argsPrefix: string[] }> => {
    const localCli = path.join(process.cwd(), "node_modules", "openclaw", "openclaw.mjs");
    try {
        await fs.access(localCli);
        return { command: process.execPath, argsPrefix: [localCli] };
    } catch {
        return { command: "openclaw", argsPrefix: [] };
    }
};

export const startOpenClawGateway = async (): Promise<void> => {
    if (await probeGateway()) {
        return;
    }
    if (managedGatewayProcess) {
        return;
    }

    const { command, argsPrefix } = await resolveOpenClawCli();
    const args = [
        ...argsPrefix,
        "gateway",
        "run",
        "--allow-unconfigured",
        "--port",
        resolveGatewayPort(),
        "--bind",
        "loopback",
        "--auth",
        "token",
    ];

    managedGatewayLog = "";
    const child = spawn(command, args, {
        env: {
            ...process.env,
            [EnvVar.CONFIG_PATH]: getOpenClawConfigPath(),
            [EnvVar.GATEWAY_TOKEN]: getGatewayToken(),
            [EnvVar.STATE_DIR]: getOpenClawStateDir(),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    managedGatewayProcess = child;
    child.stdout?.on("data", appendGatewayLog);
    child.stderr?.on("data", appendGatewayLog);
    child.once("error", (error) => {
        if (managedGatewayProcess === child) {
            managedGatewayLog = `${managedGatewayLog}\n[openclaw spawn error: ${error.message}]`;
            managedGatewayProcess = null;
        }
    });
    child.once("exit", (code, signal) => {
        if (managedGatewayProcess === child) {
            managedGatewayLog = `${managedGatewayLog}\n[openclaw exited code=${code ?? "null"} signal=${signal ?? "null"}]`;
            managedGatewayProcess = null;
        }
    });

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await probeGateway()) {
            return;
        }
        if (!managedGatewayProcess) {
            break;
        }
        await sleep(GATEWAY_STARTUP_POLL_INTERVAL_MS);
    }

    const logSuffix = managedGatewayLog.trim() ? `\n\nOpenClaw output:\n${managedGatewayLog.trim()}` : "";
    throw new OpenClawError(`OpenClaw Gateway did not become ready at ${getGatewayBaseUrl()}.${logSuffix}`);
};

export const stopOpenClawGateway = async (): Promise<void> => {
    const child = managedGatewayProcess;
    if (!child) {
        return;
    }

    managedGatewayProcess = null;
    let exited = false;
    const exitedPromise = new Promise<void>((resolve) => {
        child.once("exit", () => {
            exited = true;
            resolve();
        });
    });
    child.kill("SIGTERM");

    await Promise.race([
        exitedPromise,
        sleep(GATEWAY_SHUTDOWN_GRACE_MS).then(() => {
            if (!exited) {
                child.kill("SIGKILL");
            }
        }),
    ]);
};
