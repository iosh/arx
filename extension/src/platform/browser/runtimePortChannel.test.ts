import { describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { createRuntimePortChannel } from "./runtimePortChannel";

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

class FakePort {
  postMessage = vi.fn<(message: unknown) => void>();
  readonly #messageListeners = new Set<MessageListener>();
  readonly #disconnectListeners = new Set<DisconnectListener>();

  onMessage = {
    addListener: (listener: MessageListener) => this.#messageListeners.add(listener),
    removeListener: (listener: MessageListener) => this.#messageListeners.delete(listener),
  };

  onDisconnect = {
    addListener: (listener: DisconnectListener) => this.#disconnectListeners.add(listener),
    removeListener: (listener: DisconnectListener) => this.#disconnectListeners.delete(listener),
  };

  receive(message: unknown): void {
    for (const listener of [...this.#messageListeners]) listener(message);
  }

  disconnect(): void {
    for (const listener of [...this.#disconnectListeners]) listener();
  }
}

describe("createRuntimePortChannel", () => {
  it("maps one connected Runtime.Port to the DuplexChannel contract", () => {
    const port = new FakePort();
    const channel = createRuntimePortChannel(port as unknown as Runtime.Port);
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();
    const unsubscribeMessage = channel.onMessage(onMessage);
    const unsubscribeDisconnect = channel.onDisconnect(onDisconnect);

    channel.send({ type: "request" });
    port.receive({ type: "success" });
    port.disconnect();

    expect(port.postMessage).toHaveBeenCalledWith({ type: "request" });
    expect(onMessage).toHaveBeenCalledWith({ type: "success" });
    expect(onDisconnect).toHaveBeenCalledOnce();

    unsubscribeMessage();
    unsubscribeDisconnect();
    port.receive({ type: "later" });
    port.disconnect();

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
