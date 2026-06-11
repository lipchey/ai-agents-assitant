import { spawn } from "node:child_process";
import { ToolProviderName } from "../../../consts";
import { getLogger } from "../../../logging";
import type { ToolProvider } from "../../../types/tools";
import { localDescriptors } from "./descriptors.ts";

/* find_files/grep_code shell out to ripgrep, so warn once at startup when rg is
   missing on PATH rather than failing every later tool call. Non-fatal: a missing
   binary (ENOENT) or non-zero exit must never crash the runtime. */
const checkRipgrepAvailable = async (): Promise<void> => {
    const logger = getLogger().child({ module: "tools.local" });
    await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (missing: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (missing) {
                logger.warn("ripgrep (rg) not found on PATH; find_files/grep_code will fail until it is installed.");
            }
            resolve();
        };
        const child = spawn("rg", ["--version"], { stdio: "ignore" });
        child.once("error", () => finish(true));
        child.once("exit", (code) => finish(code !== 0));
    });
};

export const createLocalProvider = (): ToolProvider => ({
    name: ToolProviderName.LOCAL,
    catalog: localDescriptors,
    start: checkRipgrepAvailable,
});
