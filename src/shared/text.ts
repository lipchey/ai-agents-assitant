// String / number coercion + stringification helpers shared across the graph,
// swarm, and tool layers. Previously hand-rolled separately in each (readString
// vs readArgString, clampInt vs readIntegerInRange, truncate vs truncateOutput).

// Trimmed non-empty string, or undefined.
export const readString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

// Finite number, or undefined.
export const readNumber = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

// Floor + clamp to [min, max]; non-numeric input yields the fallback.
export const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
};

// Clamp a float to [0, 1].
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

// Truncate with an explicit, machine-readable marker so downstream readers know
// content was cut rather than silently shortened.
export const truncate = (value: string, maxChars: number): string => {
    return value.length <= maxChars
        ? value
        : `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
};

// Compact JSON, falling back to String() on circular/unstringifiable input.
export const safeJson = (value: unknown): string => {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

// String passthrough, else pretty JSON, else String(). For human/agent-facing
// tool results.
export const stringifyPretty = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

// Best-effort human-readable message from an arbitrary error-ish value.
export const stringifyError = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
        return value.message;
    }
    return safeJson(value);
};

// Normalized message from a thrown value (Error.message or String()).
export const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
