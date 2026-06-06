// JSON-from-LLM-text helpers shared by every node that parses a model's JSON
// reply. Models wrap JSON in prose or ```json fences, so extract the first
// balanced object before parsing.

// Pull a JSON object out of free-form model text (optionally fenced) and parse
// it. Returns null when no parseable object is present.
export const extractJsonObject = (text: string): unknown => {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
    const candidate = fenced?.[1] ?? text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end < start) {
        return null;
    }
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
};

// Narrow an unknown to a plain (non-array) object, or null.
export const asRecord = (value: unknown): Record<string, unknown> | null => {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
};
