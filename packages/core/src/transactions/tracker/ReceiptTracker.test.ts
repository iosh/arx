import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptResolution, ReplacementResolution, TransactionAdapterContext } from "../adapters/types.js";
import { createReceiptTracker } from "./ReceiptTracker.js";

const BASE_CONTEXT: TransactionAdapterContext = {
  namespace: "eip155",
  chainRef: "eip155:1",
  origin: "https://dapp.example",
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  request: {
    namespace: "eip155",
    chainRef: "eip155:1",
    payload: {
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      nonce: "0x1",
      value: "0x0",
      data: "0x",
    },
  },
  meta: {
    id: "tx-1",
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request: {
      namespace: "eip155",
      chainRef: "eip155:1",
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        nonce: "0x1",
        value: "0x0",
        data: "0x",
      },
    },
    prepared: null,
    status: "broadcast",
    hash: "0xhash",
    receipt: null,
    error: null,
    userRejected: false,
    warnings: [],
    issues: [],
    createdAt: 1_000,
    updatedAt: 1_000,
  },
};

const HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
type TimeoutHandler = Parameters<typeof globalThis.setTimeout>[0];
describe("ReceiptTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("invokes onReceipt when adapter returns a receipt", async () => {
    const receiptResolution: ReceiptResolution = {
      status: "success",
      receipt: { status: "0x1" },
    };

    const adapter = {
      fetchReceipt: vi.fn(async () => receiptResolution),
      detectReplacement: vi.fn(),
    };

    const onReceipt = vi.fn();
    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt,
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 1, maxDelayMs: 1 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);
    await vi.runOnlyPendingTimersAsync();

    expect(adapter.fetchReceipt).toHaveBeenCalledTimes(1);
    expect(onReceipt).toHaveBeenCalledWith("tx-1", receiptResolution);
  });

  it("invokes onReplacement when adapter detects replacement", async () => {
    const replacementResolution: ReplacementResolution = {
      status: "replaced",
      hash: "0xdeadbeef",
    };

    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => replacementResolution),
    };

    const onReplacement = vi.fn();
    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt: vi.fn(),
        onReplacement,
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 1, maxDelayMs: 1 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);
    await vi.runOnlyPendingTimersAsync();

    expect(adapter.fetchReceipt).toHaveBeenCalledTimes(1);
    expect(adapter.detectReplacement).toHaveBeenCalledTimes(1);
    expect(onReplacement).toHaveBeenCalledWith("tx-1", replacementResolution);
  });

  it("invokes onTimeout after exceeding max attempts", async () => {
    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => null),
    };

    const onTimeout = vi.fn();
    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt: vi.fn(),
        onReplacement: vi.fn(),
        onTimeout,
        onError: vi.fn(),
      },
      { initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 2 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(adapter.fetchReceipt).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledWith("tx-1");
  });

  it("doubles delay on each attempt until it reaches maxDelay", async () => {
    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => null),
    };

    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    setTimeoutSpy.mockImplementation(((handler: TimeoutHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === "number") {
        delays.push(timeout);
      }
      return (originalSetTimeout as typeof globalThis.setTimeout)(handler, timeout, ...args);
    }) as typeof globalThis.setTimeout);

    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt: vi.fn(),
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 100, maxDelayMs: 500, maxAttempts: 4 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(500);

    expect(delays.slice(0, 4)).toEqual([100, 200, 400, 500]);
    setTimeoutSpy.mockRestore();
  });

  it("stops tracking and clears pending timers", async () => {
    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => null),
    };

    const onReceipt = vi.fn();
    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt,
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 5 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);
    expect(tracker.isTracking("tx-1")).toBe(true);

    tracker.stop("tx-1");
    expect(tracker.isTracking("tx-1")).toBe(false);

    await vi.runOnlyPendingTimersAsync();
    expect(onReceipt).not.toHaveBeenCalled();
    expect(adapter.fetchReceipt).not.toHaveBeenCalled();
    expect(tracker.pending()).toBe(0);
  });

  it("doubles delay on each attempt until it reaches maxDelay", async () => {
    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => null),
    };

    const delays: number[] = [];

    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    setTimeoutSpy.mockImplementation(((handler: TimeoutHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === "number") {
        delays.push(timeout);
      }
      return originalSetTimeout(handler, timeout, ...(args as Parameters<typeof globalThis.setTimeout>).slice(2));
    }) as typeof globalThis.setTimeout);

    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt: vi.fn(),
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 100, maxDelayMs: 500, maxAttempts: 4 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(500);

    expect(delays.slice(0, 4)).toEqual([100, 200, 400, 500]);
    setTimeoutSpy.mockRestore();
  });

  it("stops tracking and clears pending timers", async () => {
    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => null),
    };

    const onReceipt = vi.fn();
    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt,
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 5 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);
    expect(tracker.isTracking("tx-1")).toBe(true);

    tracker.stop("tx-1");
    expect(tracker.isTracking("tx-1")).toBe(false);

    await vi.runOnlyPendingTimersAsync();
    expect(onReceipt).not.toHaveBeenCalled();
    expect(adapter.fetchReceipt).not.toHaveBeenCalled();
    expect(tracker.pending()).toBe(0);
  });

  it("restarts tracking from the initial delay when resumed", async () => {
    const adapter = {
      fetchReceipt: vi.fn(async () => null),
      detectReplacement: vi.fn(async () => null),
    };

    const delays: number[] = [];

    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    setTimeoutSpy.mockImplementation(((handler: TimeoutHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === "number") {
        delays.push(timeout);
      }
      return originalSetTimeout(handler, timeout, ...(args as Parameters<typeof globalThis.setTimeout>).slice(2));
    }) as typeof globalThis.setTimeout);

    const tracker = createReceiptTracker(
      {
        getAdapter: () => adapter,
        onReceipt: vi.fn(),
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 100, maxDelayMs: 500, maxAttempts: 5 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    tracker.resume("tx-1", BASE_CONTEXT, HASH);

    await vi.advanceTimersByTimeAsync(100);
    expect(delays.slice(-2)).toEqual([100, 200]);
    setTimeoutSpy.mockRestore();
  });

  it("calls onError when adapter is missing", async () => {
    const onError = vi.fn();
    const tracker = createReceiptTracker(
      {
        getAdapter: () => undefined,
        onReceipt: vi.fn(),
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError,
      },
      { initialDelayMs: 1, maxDelayMs: 1 },
    );

    tracker.start("tx-1", BASE_CONTEXT, HASH);
    await vi.runOnlyPendingTimersAsync();

    expect(onError).toHaveBeenCalledWith("tx-1", expect.any(Error));
    expect(tracker.pending()).toBe(0);
  });

  it("returns the number of active tracking tasks via pending()", () => {
    const tracker = createReceiptTracker(
      {
        getAdapter: () => ({
          fetchReceipt: vi.fn(async () => null),
          detectReplacement: vi.fn(async () => null),
        }),
        onReceipt: vi.fn(),
        onReplacement: vi.fn(),
        onTimeout: vi.fn(),
        onError: vi.fn(),
      },
      { initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(tracker.pending()).toBe(0);
    tracker.start("tx-1", BASE_CONTEXT, HASH);
    expect(tracker.pending()).toBe(1);
    tracker.start("tx-2", BASE_CONTEXT, HASH);
    expect(tracker.pending()).toBe(2);
    tracker.stop("tx-1");
    expect(tracker.pending()).toBe(1);
  });
});
