import type { LogRecord, StreamSinkOptions } from "../types/logging.ts";
import { textFormatter } from "./formatters.ts";

export class StreamSink {
    private readonly formatter;
    private readonly stderr;

    constructor(options: StreamSinkOptions = {}) {
        const { formatter = textFormatter, stderr = process.stderr, stdout: _stdout } = options;
        void _stdout;
        this.formatter = formatter;
        this.stderr = stderr;
    }

    write(record: LogRecord): void {
        this.stderr.write(`${this.formatter(record)}\n`);
    }
}
