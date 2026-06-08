import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { LogFormat, LogLevel } from "../src/consts";
import { configureLogging, getLogger, getOutputWriter, jsonFormatter, StreamSink, textFormatter } from "../src/logging";
import type { LogRecord, LogSink, OutputWriter } from "../src/types";

class RecordingSink implements LogSink {
    records: LogRecord[] = [];

    write(record: LogRecord): void {
        this.records.push(record);
    }
}

class RecordingOutput implements OutputWriter {
    stdout: string[] = [];
    stderr: string[] = [];

    write(text: string): void {
        this.stdout.push(text);
    }

    line(text: string): void {
        this.stdout.push(`${text}\n`);
    }

    errorLine(text: string): void {
        this.stderr.push(`${text}\n`);
    }

    blankLine(): void {
        this.stdout.push("\n");
    }
}

class CaptureStream extends Writable {
    chunks: string[] = [];

    _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
        callback();
    }

    text(): string {
        return this.chunks.join("");
    }
}

const run = (): void => {
    const sink = new RecordingSink();
    const output = new RecordingOutput();
    configureLogging({ level: LogLevel.WARN, format: LogFormat.TEXT, sink, output });

    const logger = getLogger().child({ module: "logging-smoke", shared: "context" });
    logger.debug("dropped debug");
    logger.info("dropped info");
    logger.warn("warning survived", { shared: "call", query: "x".repeat(700) });
    logger.error("error survived", { error: new Error("boom") });

    assert.equal(sink.records.length, 2, "threshold should drop debug/info and keep warn/error");
    assert.equal(sink.records[0]?.fields?.module, "logging-smoke", "child context should be merged into fields");
    assert.equal(sink.records[0]?.fields?.shared, "call", "per-call fields should override child context");
    assert.match(String(sink.records[0]?.fields?.query), /\[truncated/u, "high-cardinality string fields are truncated");

    getOutputWriter().line("plain answer");
    getOutputWriter().errorLine("plain error");
    assert.deepEqual(output.stdout, ["plain answer\n"], "one configureLogging call retargets user stdout");
    assert.deepEqual(output.stderr, ["plain error\n"], "one configureLogging call retargets user stderr");

    const textRecord = sink.records[1]!;
    const text = textFormatter(textRecord);
    assert.match(text, /ERROR/u, "text formatter includes level");
    assert.match(text, /module="logging-smoke"/u, "text formatter includes deterministic fields");
    assert.match(text, /error="boom"/u, "text formatter renders Error messages");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const json = jsonFormatter({
        level: LogLevel.INFO,
        message: "json check",
        time: new Date("2026-06-08T12:00:00.000Z"),
        fields: { circular, count: 1n, error: new Error("json boom") },
    });
    const parsed = JSON.parse(json) as { fields: { circular: { self: string }; count: string; error: { message: string } } };
    assert.equal(parsed.fields.circular.self, "[Circular]", "json formatter tolerates circular fields");
    assert.equal(parsed.fields.count, "1", "json formatter tolerates bigint fields");
    assert.equal(parsed.fields.error.message, "json boom", "json formatter preserves Error messages");

    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const streamSink = new StreamSink({ stdout, stderr, formatter: textFormatter });
    streamSink.write({ level: LogLevel.DEBUG, message: "debug diagnostic", time: new Date(), fields: {} });
    streamSink.write({ level: LogLevel.WARN, message: "warn diagnostic", time: new Date(), fields: {} });
    assert.equal(stdout.text(), "", "default StreamSink keeps diagnostics off stdout");
    assert.match(stderr.text(), /debug diagnostic/u, "default StreamSink writes low-severity diagnostics to stderr");
    assert.match(stderr.text(), /warn diagnostic/u, "default StreamSink writes warning diagnostics to stderr");
};

run();
console.log("Logging smoke test passed.");
