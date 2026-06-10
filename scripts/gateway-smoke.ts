import "dotenv/config";
import { OpenClawControl } from "../src/consts";
import { authHeaders, getGatewayBaseUrl, startOpenClawGateway, stopOpenClawGateway } from "../src/tools";

/* Probes Gateway control endpoints only; these never reach a paid provider. */
const probe = async (endpoint: string): Promise<string> => {
    try {
        const response = await fetch(`${getGatewayBaseUrl()}${endpoint}`, {
            headers: authHeaders(),
            signal: AbortSignal.timeout(5_000),
        });
        return `${response.status} ${response.statusText}`;
    } catch (error) {
        return `ERROR ${error instanceof Error ? error.message : String(error)}`;
    }
};

const run = async (): Promise<void> => {
    console.log(`Gateway base URL: ${getGatewayBaseUrl()}`);
    console.log("Starting OpenClaw Gateway (no LLM calls, no provider spend)...");
    await startOpenClawGateway();
    console.log("READY: gateway became reachable.\n");

    for (const endpoint of [
        OpenClawControl.READY_ENDPOINT,
        OpenClawControl.HEALTH_ENDPOINT,
        OpenClawControl.MODELS_ENDPOINT,
    ]) {
        console.log(`  GET ${endpoint} -> ${await probe(endpoint)}`);
    }
};

run()
    .then(async () => {
        await stopOpenClawGateway();
        console.log("\ngateway-smoke: booted, probed, and shut down cleanly. Provider cost: $0.");
    })
    .catch(async (error) => {
        await stopOpenClawGateway();
        console.error("gateway-smoke FAILED:", error instanceof Error ? error.message : error);
        process.exit(1);
    });
