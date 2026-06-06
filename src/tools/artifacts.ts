/* Store full tool output out-of-band so reasoning prompts can stay compact. */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const storeArtifact = async (blob: string): Promise<string> => {
    const artifactDir = path.join(process.cwd(), ".openclaw_artifacts");
    await fs.mkdir(artifactDir, { recursive: true });

    const hash = crypto.createHash("sha256").update(blob).digest("hex").slice(0, 12);
    const fileName = `artifact-${Date.now()}-${hash}.txt`;
    await fs.writeFile(path.join(artifactDir, fileName), blob, "utf-8");
    return `artifact://${fileName}`;
};
