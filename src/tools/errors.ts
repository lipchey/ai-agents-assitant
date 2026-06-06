// Single error type for the OpenClaw tool layer. Lives alone so any tool module
// can throw/catch it without pulling in heavier dependencies.
export class OpenClawError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "OpenClawError";
    }
}
