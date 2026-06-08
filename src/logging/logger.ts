import { DEFAULT_LOG_LEVEL, LOG_LEVEL_RANK, LogLevel } from "../consts";
import { errorMessage } from "../shared";
import type { LogFields, Logger, LoggerOptions, LogRecord, LogSink } from "../types/logging.ts";
import { normalizeLogFields } from "./fields.ts";
import { StreamSink } from "./stream-sink.ts";

const writeFallback = (error: unknown): void => {
    try {
        process.stderr.write(`logging sink failed: ${errorMessage(error)}\n`);
    } catch (fallbackError) {
        void fallbackError;
    }
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
    const level = options.level ?? DEFAULT_LOG_LEVEL;
    const sink: LogSink = options.sink ?? new StreamSink();
    const context = options.context ?? {};
    const now = options.now ?? (() => new Date());

    const emit = (recordLevel: LogLevel, message: string, fields?: LogFields): void => {
        if (LOG_LEVEL_RANK[recordLevel] < LOG_LEVEL_RANK[level]) {
            return;
        }
        const recordFields = normalizeLogFields({ ...context, ...(fields ?? {}) });
        const record: LogRecord = {
            level: recordLevel,
            message,
            time: now(),
            ...(recordFields ? { fields: recordFields } : {}),
        };
        try {
            sink.write(record);
        } catch (error) {
            writeFallback(error);
        }
    };

    return {
        debug: (message, fields) => emit(LogLevel.DEBUG, message, fields),
        info: (message, fields) => emit(LogLevel.INFO, message, fields),
        warn: (message, fields) => emit(LogLevel.WARN, message, fields),
        error: (message, fields) => emit(LogLevel.ERROR, message, fields),
        child: (childContext) => createLogger({ level, sink, context: { ...context, ...childContext }, now }),
    };
};
