import { describe, expect, it, vi } from "vitest";
import { createInvokeClient } from "./client.js";
import { InvokeTransportError } from "./errors.js";
import type { InvokeChannel } from "./protocol.js";

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
};

describe("createInvokeClient", () => {
  it("does not report connected after a disconnect invalidates an in-flight connect", async () => {
    const connectDeferred = createDeferred<void>();
    let disconnectListener: ((error?: unknown) => void) | undefined;

    const channel: InvokeChannel = {
      connect: vi.fn(() => connectDeferred.promise),
      postMessage: vi.fn(),
      onMessage: vi.fn(() => () => {}),
      onDisconnect: vi.fn((listener) => {
        disconnectListener = listener;
        return () => {
          disconnectListener = undefined;
        };
      }),
    };

    const client = createInvokeClient({ channel });
    const statuses: string[] = [];
    client.onConnectionStatus((status) => {
      statuses.push(status);
    });

    const pendingConnect = client.connect();
    disconnectListener?.(new Error("port disconnected"));
    connectDeferred.resolve();

    await expect(pendingConnect).rejects.toBeInstanceOf(InvokeTransportError);
    expect(statuses).toEqual([]);
  });
});
