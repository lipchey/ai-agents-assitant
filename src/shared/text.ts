export const readString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

export const readNumber = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
};

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const truncate = (value: string, maxChars: number): string => {
    return value.length <= maxChars
        ? value
        : `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
};

export const safeJson = (value: unknown): string => {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

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

export const stringifyError = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
        return value.message;
    }
    return safeJson(value);
};

export const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
