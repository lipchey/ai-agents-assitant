import { errorMessage } from "../shared";
import type { OutputWriter, OutputWriterOptions } from "../types/logging.ts";

const fallbackOutputFailure = (error: unknown): void => {
    try {
        process.stderr.write(`output write failed: ${errorMessage(error)}\n`);
    } catch (fallbackError) {
        void fallbackError;
    }
};

const safeWrite = (stream: NodeJS.WritableStream, text: string): void => {
    try {
        stream.write(text);
    } catch (error) {
        fallbackOutputFailure(error);
    }
};

class StreamOutputWriter implements OutputWriter {
    constructor(
        private readonly stdout: NodeJS.WritableStream,
        private readonly stderr: NodeJS.WritableStream,
    ) {}

    write(text: string): void {
        safeWrite(this.stdout, text);
    }

    line(text: string): void {
        safeWrite(this.stdout, `${text}\n`);
    }

    errorLine(text: string): void {
        safeWrite(this.stderr, `${text}\n`);
    }

    blankLine(): void {
        safeWrite(this.stdout, "\n");
    }
}

export const createOutputWriter = (options: OutputWriterOptions = {}): OutputWriter =>
    new StreamOutputWriter(options.stdout ?? process.stdout, options.stderr ?? process.stderr);
