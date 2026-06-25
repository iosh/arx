import { describe, expect, it, vi } from "vitest";
import type { BrowserPortChannel } from "./uiPortTransport";
import { createWalletBridgePortTransport } from "./walletBridgePortTransport";

const createChannel = () => {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<(error?: unknown) => void>();

  const channel: BrowserPortChannel & {
    emitMessage(message: unknown): void;
    emitDisconnect(error?: unknown): void;
  } = {
    connect: vi.fn(async () => {}),
    postMessage: vi.fn(),
    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onDisconnect: (listener) => {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },
    emitMessage: (message) => {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
    emitDisconnect: (error) => {
      for (const listener of disconnectListeners) {
        listener(error);
      }
    },
  };

  return channel;
};

describe("createWalletBridgePortTransport", () => {
  it("reconnects after disconnect while events are subscribed", async () => {
    vi.useFakeTimers();

    try {
      const channel = createChannel();
      const transport = createWalletBridgePortTransport(channel, { logger: { warn: vi.fn() } });
      const events: unknown[] = [];
      const subscribe = transport.subscribe;

      expect(subscribe).toBeTypeOf("function");
      if (!subscribe) {
        throw new Error("wallet bridge transport should expose subscribe()");
      }

      const unsubscribe = subscribe((event) => {
        events.push(event);
      });

      await Promise.resolve();
      expect(channel.connect).toHaveBeenCalledTimes(1);

      channel.emitDisconnect(new Error("port disconnected"));
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();

      expect(channel.connect).toHaveBeenCalledTimes(2);

      channel.emitMessage({
        type: "wallet:event",
        version: 1,
        event: "wallet:invalidation",
        topic: "accounts",
      });

      expect(events).toEqual([
        {
          type: "wallet:event",
          version: 1,
          event: "wallet:invalidation",
          topic: "accounts",
        },
      ]);

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
