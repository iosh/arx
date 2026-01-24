import { describe, expect, it, vi } from "vitest";
import type Browser from "webextension-polyfill";
import { createUiPortTransport } from "./uiPortTransport";

type MessageListener = (message: unknown, port: Browser.Runtime.Port) => void;
type DisconnectListener = (port: Browser.Runtime.Port) => void;

class FakePort {
  name = "arx:ui";
  error: Browser.Runtime.Port["error"] = undefined;

  messages: unknown[] = [];

  // Keep a history list so we can simulate "queued" events firing even after removeListener.
  private messageListeners = new Set<MessageListener>();
  private disconnectListeners = new Set<DisconnectListener>();
  private allMessageListeners: MessageListener[] = [];
  private allDisconnectListeners: DisconnectListener[] = [];

  postMessage = (msg: unknown) => {
    this.messages.push(msg);
  };

  onMessage = {
    addListener: (fn: MessageListener) => {
      this.messageListeners.add(fn);
      this.allMessageListeners.push(fn);
    },
    removeListener: (fn: MessageListener) => {
      this.messageListeners.delete(fn);
    },
  };

  onDisconnect = {
    addListener: (fn: DisconnectListener) => {
      this.disconnectListeners.add(fn);
      this.allDisconnectListeners.push(fn);
    },
    removeListener: (fn: DisconnectListener) => {
      this.disconnectListeners.delete(fn);
    },
  };

  disconnect = () => {
    // Standard path: only currently attached listeners.
    for (const fn of this.disconnectListeners) fn(this as unknown as Browser.Runtime.Port);
  };

  emitMessage(message: unknown, opts?: { includeRemoved?: boolean }) {
    const fns = opts?.includeRemoved ? this.allMessageListeners : Array.from(this.messageListeners);
    for (const fn of fns) fn(message, this as unknown as Browser.Runtime.Port);
  }

  emitDisconnect(opts?: { includeRemoved?: boolean }) {
    const fns = opts?.includeRemoved ? this.allDisconnectListeners : Array.from(this.disconnectListeners);
    for (const fn of fns) fn(this as unknown as Browser.Runtime.Port);
  }
}

describe("createUiPortTransport", () => {
  it("connect resolves only after first inbound message", async () => {
    const port = new FakePort();
    const runtime = { connect: vi.fn(() => port) };
    const browser = { runtime } as unknown as typeof Browser;

    const transport = createUiPortTransport({ browser });

    const connectPromise = transport.connect();
    await Promise.resolve(); // allow connect() to call runtime.connect()
    expect(runtime.connect).toHaveBeenCalledTimes(1);
    expect(transport.isConnected?.()).toBe(false);

    port.emitMessage({ type: "ui:event", event: "ui.snapshotChanged" });
    await connectPromise;

    expect(transport.isConnected?.()).toBe(true);
  });

  it("postMessage throws if called before ready", async () => {
    const port = new FakePort();
    const runtime = { connect: vi.fn(() => port) };
    const browser = { runtime } as unknown as typeof Browser;

    const transport = createUiPortTransport({ browser });
    const connectPromise = transport.connect(); // Don't await; keep it not-ready.
    await Promise.resolve(); // ensure port exists but not ready

    expect(() => transport.postMessage({ type: "ui:request", id: "1", method: "ui.snapshot.get" })).toThrow(
      /not ready/i,
    );

    port.emitMessage({ type: "ui:event", event: "ui.snapshotChanged" });
    await connectPromise;

    expect(() => transport.postMessage({ type: "ui:request", id: "2", method: "ui.snapshot.get" })).not.toThrow();
  });

  it("ignores stale port disconnect after a retry connects a new port", async () => {
    vi.useFakeTimers();
    try {
      const port1 = new FakePort();
      const port2 = new FakePort();

      const runtime = { connect: vi.fn().mockReturnValueOnce(port1).mockReturnValueOnce(port2) };
      const browser = { runtime } as unknown as typeof Browser;
      const transport = createUiPortTransport({ browser });

      const first = transport.connect();
      await Promise.resolve(); // allow runtime.connect() to be called
      // Attach the rejection handler before advancing timers to avoid unhandledRejection.
      const firstRejection = expect(first).rejects.toThrow(/timed out/i);
      // Trigger the internal "ready wait" timeout (30s).
      await vi.advanceTimersByTimeAsync(30_000);
      await firstRejection;

      const second = transport.connect();
      await Promise.resolve(); // allow retry runtime.connect() to be called
      expect(runtime.connect).toHaveBeenCalledTimes(2);

      // Simulate a late/queued disconnect event from the old port firing after the retry.
      port1.emitDisconnect({ includeRemoved: true });

      // Now make the new port ready.
      port2.emitMessage({ type: "ui:event", event: "ui.snapshotChanged" });
      await expect(second).resolves.toBeUndefined();
      expect(transport.isConnected?.()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
