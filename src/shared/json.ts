/* LLM replies may wrap JSON in prose/fences; parse the first balanced object. */

const parseBalancedJsonObjectAt = (text: string, start: number): unknown => {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }

        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "{") {
            depth += 1;
            continue;
        }
        if (char !== "}") {
            continue;
        }

        depth -= 1;
        if (depth !== 0) {
            continue;
        }

        const slice = text.slice(start, index + 1);
        try {
            return JSON.parse(slice);
        } catch {
            return undefined;
        }
    }

    return undefined;
};

const extractFromCandidate = (candidate: string): unknown => {
    for (let start = candidate.indexOf("{"); start >= 0; start = candidate.indexOf("{", start + 1)) {
        const parsed = parseBalancedJsonObjectAt(candidate, start);
        if (parsed !== undefined) {
            return parsed;
        }
    }
    return null;
};

export const extractJsonObject = (text: string): unknown => {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
    if (fenced?.[1]) {
        const parsed = extractFromCandidate(fenced[1]);
        if (parsed !== null) {
            return parsed;
        }
    }

    return extractFromCandidate(text);
};

export const asRecord = (value: unknown): Record<string, unknown> | null => {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
};
