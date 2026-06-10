import { DEFAULT_LOG_FORMAT, DEFAULT_LOG_LEVEL, EnvVar, LogLevel, isLogFormat, isLogLevel } from "../consts";
import { readString } from "../shared";
import type { LogFormat } from "../consts";
import type {
    ConfigureLoggingOptions,
    LogFields,
    Logger,
    LogSink,
    OutputWriter,
    OutputWriterOptions,
    StreamSinkOptions,
} from "../types/logging.ts";
import { formatterForFormat } from "./formatters.ts";
import { createLogger } from "./logger.ts";
import { createOutputWriter } from "./output.ts";
import { StreamSink } from "./stream-sink.ts";

type ConfigWarning = {
    message: string;
    fields: LogFields;
};

type Runtime = {
    logger: Logger;
    output: OutputWriter;
    sink: LogSink;
};

let runtime: Runtime | undefined;

const invalidEnvWarning = (envVar: EnvVar, value: string, fallback: string): ConfigWarning => ({
    message: "Invalid logging configuration value; using default.",
    fields: { envVar, value, fallback },
});

const readEnvLevel = (): { level: LogLevel; warnings: ConfigWarning[] } => {
    const raw = readString(process.env[EnvVar.LOG_LEVEL]);
    if (!raw) {
        return { level: DEFAULT_LOG_LEVEL, warnings: [] };
    }
    const normalized = raw.toLowerCase();
    return isLogLevel(normalized)
        ? { level: normalized, warnings: [] }
        : { level: DEFAULT_LOG_LEVEL, warnings: [invalidEnvWarning(EnvVar.LOG_LEVEL, raw, DEFAULT_LOG_LEVEL)] };
};

const readEnvFormat = (): { format: LogFormat; warnings: ConfigWarning[] } => {
    const raw = readString(process.env[EnvVar.LOG_FORMAT]);
    if (!raw) {
        return { format: DEFAULT_LOG_FORMAT, warnings: [] };
    }
    const normalized = raw.toLowerCase();
    return isLogFormat(normalized)
        ? { format: normalized, warnings: [] }
        : { format: DEFAULT_LOG_FORMAT, warnings: [invalidEnvWarning(EnvVar.LOG_FORMAT, raw, DEFAULT_LOG_FORMAT)] };
};

const buildRuntime = (options: ConfigureLoggingOptions): { runtime: Runtime; warnings: ConfigWarning[] } => {
    const envLevel = options.level ? { level: options.level, warnings: [] } : readEnvLevel();
    const envFormat = options.format ? { format: options.format, warnings: [] } : readEnvFormat();
    const streamOptions: StreamSinkOptions = { formatter: formatterForFormat(envFormat.format) };
    if (options.diagnosticStderr) {
        streamOptions.stderr = options.diagnosticStderr;
    }
    const outputOptions: OutputWriterOptions = {};
    if (options.userStdout) {
        outputOptions.stdout = options.userStdout;
    }
    if (options.userStderr) {
        outputOptions.stderr = options.userStderr;
    }
    const sink = options.sink ?? new StreamSink(streamOptions);
    const output = options.output ?? createOutputWriter(outputOptions);
    return {
        runtime: {
            logger: createLogger({ level: envLevel.level, sink }),
            output,
            sink,
        },
        warnings: [...envLevel.warnings, ...envFormat.warnings],
    };
};

const emitConfigWarnings = (sink: LogSink, warnings: ConfigWarning[]): void => {
    if (warnings.length === 0) {
        return;
    }
    const logger = createLogger({ level: LogLevel.WARN, sink, context: { module: "logging" } });
    for (const warning of warnings) {
        logger.warn(warning.message, warning.fields);
    }
};

const installRuntime = (options: ConfigureLoggingOptions): Runtime => {
    const built = buildRuntime(options);
    runtime = built.runtime;
    emitConfigWarnings(built.runtime.sink, built.warnings);
    return built.runtime;
};

export const configureLogging = (options: ConfigureLoggingOptions = {}): void => {
    installRuntime(options);
};

export const getLogger = (): Logger => (runtime ?? installRuntime({})).logger;

export const getOutputWriter = (): OutputWriter => (runtime ?? installRuntime({})).output;
