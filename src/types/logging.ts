import type { LogFormat, LogLevel } from "../consts/logging.ts";

export type LogFields = Record<string, unknown>;

export interface LogRecord {
    level: LogLevel;
    message: string;
    time: Date;
    fields?: LogFields;
}

export interface LogSink {
    write(record: LogRecord): void;
}

export type LogFormatter = (record: LogRecord) => string;

export interface Logger {
    debug(message: string, fields?: LogFields): void;
    info(message: string, fields?: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
    child(context: LogFields): Logger;
}

export interface OutputWriter {
    write(text: string): void;
    line(text: string): void;
    errorLine(text: string): void;
    blankLine(): void;
}

export interface LoggerOptions {
    level?: LogLevel;
    sink?: LogSink;
    context?: LogFields;
    now?: () => Date;
}

export interface StreamSinkOptions {
    formatter?: LogFormatter;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
}

export interface OutputWriterOptions {
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
}

export interface ConfigureLoggingOptions {
    level?: LogLevel;
    format?: LogFormat;
    sink?: LogSink;
    output?: OutputWriter;
    diagnosticStdout?: NodeJS.WritableStream;
    diagnosticStderr?: NodeJS.WritableStream;
    userStdout?: NodeJS.WritableStream;
    userStderr?: NodeJS.WritableStream;
}
