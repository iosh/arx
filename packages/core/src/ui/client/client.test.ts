import { describe, expect, it, vi } from "vitest";
import { UI_EVENT_ENTRY_CHANGED } from "../protocol/events.js";
import { createUiClient, type UiTransport } from "./index.js";

const createMockTransport = () => {
  const messageListeners = new Set<(m: unknown) => void>();
  const disconnectListeners = new Set<(e?: unknown) => void>();

  const sent: unknown[] = [];
  let connectCalls = 0;
  let connected = false;

  // Deterministic test sync point: await the next postMessage().
  const sentWaiters: Array<(m: unknown) => void> = [];
  const nextSent = () =>
    new Promise<unknown>((resolve) => {
      sentWaiters.push(resolve);
    });

  const transport: UiTransport & {
    sent: unknown[];
    connectCalls: () => number;
    emit: (m: unknown) => void;
    disconnectNow: (e?: unknown) => void;
    nextSent: () => Promise<unknown>;
  } = {
    connect: async () => {
      connectCalls += 1;
      connected = true;
    },
    postMessage: (m) => {
      sent.push(m);
      const resolve = sentWaiters.shift();
      if (resolve) resolve(m);
    },
    onMessage: (fn) => {
      messageListeners.add(fn);
      return () => messageListeners.delete(fn);
    },
    onDisconnect: (fn) => {
      disconnectListeners.add(fn);
      return () => disconnectListeners.delete(fn);
    },
    isConnected: () => connected,

    sent,
    connectCalls: () => connectCalls,
    emit: (m) => {
      for (const fn of messageListeners) fn(m);
    },
    disconnectNow: (e) => {
      connected = false;
      for (const fn of disconnectListeners) fn(e);
    },
    nextSent,
  };

  return transport;
};

describe("ui client runtime", () => {
  it("matches request/response", async () => {
    const transport = createMockTransport();
    const client = createUiClient({
      transport,
      createRequestId: () => "id1",
      requestTimeoutMs: 1_000,
    });

    try {
      const p = client.call("ui.onboarding.openTab", { reason: "manual_open" });

      const msg = await transport.nextSent();
      expect(msg).toMatchObject({
        type: "ui:request",
        id: "id1",
        method: "ui.onboarding.openTab",
        params: { reason: "manual_open" },
      });

      transport.emit({
        type: "ui:response",
        id: "id1",
        result: { activationPath: "focus" },
      });
      await expect(p).resolves.toEqual({ activationPath: "focus" });
    } finally {
      client.destroy();
    }
  });

  it("rejects with UiRemoteError on ui:error", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport, createRequestId: () => "id1", requestTimeoutMs: 1_000 });

    try {
      const p = client.call("ui.onboarding.openTab", { reason: "manual_open" });

      await transport.nextSent();

      transport.emit({
        type: "ui:error",
        id: "id1",
        error: {
          kind: "ArxError",
          name: "RpcInvalidRequestError",
          code: "global.rpc.invalid_request",
          message: "nope",
        },
        context: { namespace: "eip155", chainRef: "eip155:1" },
      });

      await expect(p).rejects.toMatchObject({
        name: "UiRemoteError",
        remoteName: "RpcInvalidRequestError",
        code: "global.rpc.invalid_request",
        message: "nope",
        context: { namespace: "eip155", chainRef: "eip155:1" },
      });
    } finally {
      client.destroy();
    }
  });

  it("rejects a pending request when a reply envelope is invalid but correlatable", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport, createRequestId: () => "id1", requestTimeoutMs: 1_000 });

    try {
      const p = client.call("ui.onboarding.openTab", { reason: "manual_open" });

      await transport.nextSent();

      transport.emit({ type: "ui:response", id: "id1" });

      await expect(p).rejects.toMatchObject({ name: "UiProtocolError" });
    } finally {
      client.destroy();
    }
  });

  it("rejects local aborts with a plain Error instead of UiProtocolError", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport, createRequestId: () => "id1", requestTimeoutMs: 1_000 });
    const controller = new AbortController();

    try {
      const pendingRequest = client.call(
        "ui.onboarding.openTab",
        { reason: "manual_open" },
        { signal: controller.signal },
      );

      await transport.nextSent();
      controller.abort();

      await expect(pendingRequest).rejects.toMatchObject({
        name: "Error",
        message: "UI request aborted",
      });
    } finally {
      client.destroy();
    }
  });

  it("reconnects on disconnect when there is at least one event listener", async () => {
    vi.useFakeTimers();

    const transport = createMockTransport();
    const client = createUiClient({ transport });

    const unsubscribe = client.on(UI_EVENT_ENTRY_CHANGED, () => {});

    // First connect is async; allow it to start.
    await Promise.resolve();

    transport.disconnectNow(new Error("port disconnected"));

    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();

    expect(transport.connectCalls()).toBeGreaterThanOrEqual(2);

    unsubscribe();
    client.destroy();

    vi.useRealTimers();
  });

  it("rejects pending requests when the bridge disconnects", async () => {
    const transport = createMockTransport();
    const client = createUiClient({ transport, createRequestId: () => "id1", requestTimeoutMs: 1_000 });

    try {
      const pendingRequest = client.call("ui.onboarding.openTab", { reason: "manual_open" });

      await transport.nextSent();
      transport.disconnectNow(new Error("port disconnected"));

      await expect(pendingRequest).rejects.toThrow("UI bridge disconnected");
    } finally {
      client.destroy();
    }
  });

  it("emits connection status transitions across reconnects", async () => {
    vi.useFakeTimers();

    const transport = createMockTransport();
    const client = createUiClient({ transport });

    try {
      const statuses: string[] = [];
      const unsubscribe = client.onConnectionStatus((status) => {
        statuses.push(status);
      });

      await Promise.resolve();
      expect(statuses).toEqual(["connected"]);

      transport.disconnectNow(new Error("port disconnected"));
      expect(statuses).toEqual(["connected", "disconnected"]);

      vi.advanceTimersByTime(300);
      await vi.runAllTimersAsync();

      expect(statuses).toEqual(["connected", "disconnected", "connected"]);

      unsubscribe();
    } finally {
      client.destroy();
      vi.useRealTimers();
    }
  });

  it("stops auto-reconnect once the last event listener unsubscribes", async () => {
    vi.useFakeTimers();

    const transport = createMockTransport();
    const client = createUiClient({ transport });

    try {
      const unsubscribe = client.on(UI_EVENT_ENTRY_CHANGED, () => {});

      await Promise.resolve();
      transport.disconnectNow(new Error("port disconnected"));

      unsubscribe();

      vi.advanceTimersByTime(300);
      await vi.runAllTimersAsync();

      expect(transport.connectCalls()).toBe(1);
    } finally {
      client.destroy();
      vi.useRealTimers();
    }
  });
});
