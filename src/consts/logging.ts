export const LogLevel = {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const isLogLevel = (value: unknown): value is LogLevel =>
    typeof value === "string" && Object.values(LogLevel).includes(value as LogLevel);

export const LogFormat = {
    TEXT: "text",
    JSON: "json",
} as const;

export type LogFormat = (typeof LogFormat)[keyof typeof LogFormat];

export const isLogFormat = (value: unknown): value is LogFormat =>
    typeof value === "string" && Object.values(LogFormat).includes(value as LogFormat);

/* A record emits when its rank is greater than or equal to the configured threshold. */
export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 10,
    [LogLevel.INFO]: 20,
    [LogLevel.WARN]: 30,
    [LogLevel.ERROR]: 40,
};

export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.INFO;
export const DEFAULT_LOG_FORMAT: LogFormat = LogFormat.TEXT;

/* Structured fields can contain task text or provider diagnostics, so keep them bounded by default. */
export const LOG_FIELD_STRING_MAX_CHARS = 500;
export const LOG_FIELD_MAX_DEPTH = 4;
export const LOG_FIELD_MAX_ARRAY_ITEMS = 20;
