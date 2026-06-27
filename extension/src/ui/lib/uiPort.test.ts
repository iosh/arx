import { describe, expect, it, vi } from "vitest";
import type Browser from "webextension-polyfill";
import { createUiPort } from "./uiPort";

type MessageListener = (message: unknown, port: Browser.Runtime.Port) => void;
type DisconnectListener = (port: Browser.Runtime.Port) => void;

class FakePort {
  name = "arx:ui";
  error: Browser.Runtime.Port["error"] = undefined;
  messages: unknown[] = [];

  #messageListeners = new Set<MessageListener>();
  #disconnectListeners = new Set<DisconnectListener>();
  #allMessageListeners: MessageListener[] = [];
  #allDisconnectListeners: DisconnectListener[] = [];

  postMessage = (message: unknown) => {
    this.messages.push(message);
  };

  onMessage = {
    addListener: (listener: MessageListener) => {
      this.#messageListeners.add(listener);
      this.#allMessageListeners.push(listener);
    },
    removeListener: (listener: MessageListener) => {
      this.#messageListeners.delete(listener);
    },
  };

  onDisconnect = {
    addListener: (listener: DisconnectListener) => {
      this.#disconnectListeners.add(listener);
      this.#allDisconnectListeners.push(listener);
    },
    removeListener: (listener: DisconnectListener) => {
      this.#disconnectListeners.delete(listener);
    },
  };

  emitMessage(message: unknown, opts?: { includeRemoved?: boolean }) {
    const listeners = opts?.includeRemoved ? this.#allMessageListeners : Array.from(this.#messageListeners);
    for (const listener of listeners) {
      listener(message, this as unknown as Browser.Runtime.Port);
    }
  }

  emitDisconnect(opts?: { includeRemoved?: boolean }) {
    const listeners = opts?.includeRemoved ? this.#allDisconnectListeners : Array.from(this.#disconnectListeners);
    for (const listener of listeners) {
      listener(this as unknown as Browser.Runtime.Port);
    }
  }
}

describe("createUiPort", () => {
  it("connects only after the ready handshake arrives", async () => {
    const port = new FakePort();
    const runtime = { connect: vi.fn(() => port) };
    const browser = { runtime } as unknown as typeof Browser;
    const uiPort = createUiPort({ browser });

    let connected = false;
    const pendingConnect = uiPort.connect().then(() => {
      connected = true;
    });

    await Promise.resolve();
    port.emitMessage({ kind: "event", target: "host", name: "entryChanged", payload: null });
    await Promise.resolve();

    expect(connected).toBe(false);

    port.emitMessage({ kind: "ready" });
    await pendingConnect;

    expect(runtime.connect).toHaveBeenCalledTimes(1);
  });

  it("ignores stale disconnects after a retry binds a new port", async () => {
    vi.useFakeTimers();
    try {
      const firstPort = new FakePort();
      const secondPort = new FakePort();
      const runtime = {
        connect: vi.fn().mockReturnValueOnce(firstPort).mockReturnValueOnce(secondPort),
      };
      const browser = { runtime } as unknown as typeof Browser;
      const uiPort = createUiPort({ browser });

      const firstConnect = uiPort.connect();
      await Promise.resolve();
      const firstRejection = expect(firstConnect).rejects.toThrow(/connect-timeout/i);
      await vi.advanceTimersByTimeAsync(30_000);
      await firstRejection;

      const secondConnect = uiPort.connect();
      await Promise.resolve();
      firstPort.emitDisconnect({ includeRemoved: true });
      secondPort.emitMessage({ kind: "ready" });

      await expect(secondConnect).resolves.toBeUndefined();
      expect(runtime.connect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
