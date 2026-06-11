/*
 * Unit tests for the provider-layer retry wrapper (src/models/retry.ts).
 * No network: failures come from stubbed functions, time from an injected
 * sleep recorder, jitter from an injected random.
 */
import { describe, expect, it, vi } from "vitest";
import { LLM_RETRY_BASE_DELAY_MS } from "../../src/consts";
import { isTransientLlmError, withLlmRetries } from "../../src/models/retry.ts";
import type { RetryAttempt } from "../../src/models/retry.ts";

const statusError = (status: number): Error => Object.assign(new Error(`HTTP ${status}`), { status });

const instantSleep = (): Promise<void> => Promise.resolve();

describe("isTransientLlmError", () => {
    it("retries 408/429/5xx statuses but never other 4xx", () => {
        expect(isTransientLlmError(statusError(408))).toBe(true);
        expect(isTransientLlmError(statusError(429))).toBe(true);
        expect(isTransientLlmError(statusError(500))).toBe(true);
        expect(isTransientLlmError(statusError(503))).toBe(true);
        expect(isTransientLlmError(statusError(400))).toBe(false);
        expect(isTransientLlmError(statusError(401))).toBe(false);
        expect(isTransientLlmError(statusError(404))).toBe(false);
    });

    it("treats an HTTP status as authoritative over a transient-looking name", () => {
        const error = Object.assign(new Error("bad request"), { status: 400, name: "TimeoutError" });
        expect(isTransientLlmError(error)).toBe(false);
    });

    it("recognizes timeout and connection error names", () => {
        const timeout = new Error("operation timed out");
        timeout.name = "TimeoutError";
        const connection = new Error("connect failed");
        connection.name = "APIConnectionError";
        expect(isTransientLlmError(timeout)).toBe(true);
        expect(isTransientLlmError(connection)).toBe(true);
    });

    it("recognizes network codes through the cause chain", () => {
        const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        const wrapped = new TypeError("fetch failed", { cause });
        expect(isTransientLlmError(wrapped)).toBe(true);
    });

    it("does not retry unknown errors or non-errors", () => {
        expect(isTransientLlmError(new Error("boom"))).toBe(false);
        expect(isTransientLlmError("boom")).toBe(false);
        expect(isTransientLlmError(undefined)).toBe(false);
    });
});

describe("withLlmRetries", () => {
    it("returns the first successful result without retrying", async () => {
        const onRetry = vi.fn();
        const operation = vi.fn().mockResolvedValue("ok");

        await expect(withLlmRetries(operation, { onRetry, sleep: instantSleep })).resolves.toBe("ok");
        expect(operation).toHaveBeenCalledTimes(1);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it("retries transient failures with exponential full-jitter delays", async () => {
        const delays: number[] = [];
        const attempts: RetryAttempt[] = [];
        const operation = vi
            .fn()
            .mockRejectedValueOnce(statusError(429))
            .mockRejectedValueOnce(statusError(503))
            .mockResolvedValue("recovered");

        const result = await withLlmRetries(operation, {
            maxRetries: 2,
            onRetry: (info) => attempts.push(info),
            sleep: (ms) => {
                delays.push(ms);
                return Promise.resolve();
            },
            /* random() = 1 makes the full-jitter upper bound exact: base * 2^n. */
            random: () => 1,
        });

        expect(result).toBe("recovered");
        expect(operation).toHaveBeenCalledTimes(3);
        expect(delays).toEqual([LLM_RETRY_BASE_DELAY_MS, LLM_RETRY_BASE_DELAY_MS * 2]);
        expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
        expect(attempts[0]?.maxRetries).toBe(2);
    });

    it("throws immediately on a non-retryable error", async () => {
        const onRetry = vi.fn();
        const operation = vi.fn().mockRejectedValue(statusError(400));

        await expect(withLlmRetries(operation, { maxRetries: 3, onRetry, sleep: instantSleep })).rejects.toThrow(
            "HTTP 400",
        );
        expect(operation).toHaveBeenCalledTimes(1);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it("exhausts the retry budget and rethrows the last transient error", async () => {
        const operation = vi.fn().mockRejectedValue(statusError(503));

        await expect(
            withLlmRetries(operation, { maxRetries: 2, sleep: instantSleep, random: () => 0.5 }),
        ).rejects.toThrow("HTTP 503");
        expect(operation).toHaveBeenCalledTimes(3);
    });

    it("supports maxRetries 0 as a hard single attempt", async () => {
        const operation = vi.fn().mockRejectedValue(statusError(429));

        await expect(withLlmRetries(operation, { maxRetries: 0, sleep: instantSleep })).rejects.toThrow("HTTP 429");
        expect(operation).toHaveBeenCalledTimes(1);
    });
});
