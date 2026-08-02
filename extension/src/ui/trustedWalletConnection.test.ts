import { afterEach, describe, expect, it, vi } from "vitest";
import type browserDefault from "webextension-polyfill";
import type { Runtime } from "webextension-polyfill";
import { PORT_HOST_READY_MESSAGE } from "@/transport/browserPort";
import { WALLET_UI_PORT_NAME } from "@/transport/portNames";
import { WALLET_UI_INPUT_MESSAGE } from "@/transport/walletUiInput";
import { connectTrustedWallet } from "./trustedWalletConnection";

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      connect: vi.fn(),
    },
  },
}));

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

class FakeInputTarget {
  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) {
      return;
    }

    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) {
      return;
    }

    this.#listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, isTrusted: boolean): void {
    const event = { isTrusted } as Event;
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class FakePort {
  readonly postMessage = vi.fn<(message: unknown) => void>();
  readonly #messageListeners = new Set<MessageListener>();
  readonly #disconnectListeners = new Set<DisconnectListener>();

  readonly onMessage = {
    addListener: (listener: MessageListener) => this.#messageListeners.add(listener),
    removeListener: (listener: MessageListener) => this.#messageListeners.delete(listener),
  };

  readonly onDisconnect = {
    addListener: (listener: DisconnectListener) => this.#disconnectListeners.add(listener),
    removeListener: (listener: DisconnectListener) => this.#disconnectListeners.delete(listener),
  };

  receive(message: unknown): void {
    for (const listener of [...this.#messageListeners]) {
      listener(message);
    }
  }

  disconnect(): void {
    for (const listener of [...this.#disconnectListeners]) {
      listener();
    }
  }
}

const createHarness = () => {
  const port = new FakePort();
  const runtime = {
    connect: vi.fn(() => port as unknown as Runtime.Port),
  };
  const inputTarget = new FakeInputTarget();
  const connectionPromise = connectTrustedWallet({
    browser: { runtime } as unknown as Pick<typeof browserDefault, "runtime">,
    inputTarget: inputTarget as unknown as EventTarget,
  });

  return { connectionPromise, inputTarget, port, runtime };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("connectTrustedWallet", () => {
  it("waits for the background host before exposing one Wallet client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { connectionPromise, inputTarget, port, runtime } = createHarness();

    inputTarget.dispatch("pointermove", true);
    expect(port.postMessage).not.toHaveBeenCalled();

    port.receive(PORT_HOST_READY_MESSAGE);
    const connection = await connectionPromise;

    const status = connection.wallet.getStatus();
    port.receive({ type: "success", id: 1, result: "locked" });
    await expect(status).resolves.toBe("locked");

    inputTarget.dispatch("pointermove", false);
    expect(port.postMessage).toHaveBeenCalledOnce();

    inputTarget.dispatch("pointermove", true);
    vi.setSystemTime(9_999);
    inputTarget.dispatch("keydown", true);
    vi.setSystemTime(10_000);
    inputTarget.dispatch("keydown", true);

    expect(runtime.connect).toHaveBeenCalledOnce();
    expect(runtime.connect).toHaveBeenCalledWith({ name: WALLET_UI_PORT_NAME });
    expect(port.postMessage.mock.calls).toEqual([
      [{ type: "request", id: 1, method: "getStatus" }],
      [WALLET_UI_INPUT_MESSAGE],
      [WALLET_UI_INPUT_MESSAGE],
    ]);

    connection.stopInputReporting();
    vi.setSystemTime(20_000);
    inputTarget.dispatch("pointerdown", true);
    expect(port.postMessage).toHaveBeenCalledTimes(3);
  });

  it("fails when the Port disconnects before the background host is ready", async () => {
    const { connectionPromise, port, runtime } = createHarness();

    port.disconnect();

    await expect(connectionPromise).rejects.toThrow("before its host was ready");
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(runtime.connect).toHaveBeenCalledOnce();
  });
});
