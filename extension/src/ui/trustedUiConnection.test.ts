import { WalletChannelDisconnectedError } from "@arx/wallet-api/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type browserDefault from "webextension-polyfill";
import type { Runtime } from "webextension-polyfill";
import { WALLET_UI_PORT_NAME } from "@/channels/portNames";
import { WALLET_UI_INPUT_MESSAGE } from "@/channels/walletUiInput";
import { createTrustedUiConnection } from "./trustedUiConnection";

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      connect: vi.fn(),
    },
  },
}));

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

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
  const inputTarget = new EventTarget();
  const connection = createTrustedUiConnection({
    browser: { runtime } as unknown as Pick<typeof browserDefault, "runtime">,
    inputTarget,
  });

  return { connection, inputTarget, port, runtime };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createTrustedUiConnection", () => {
  it("uses one port for Wallet requests and throttled first-party input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { connection, inputTarget, port, runtime } = createHarness();

    const status = connection.wallet.getStatus();
    port.receive({ type: "success", id: 1, result: "locked" });
    await expect(status).resolves.toBe("locked");

    inputTarget.dispatchEvent(new Event("pointermove"));
    vi.setSystemTime(9_999);
    inputTarget.dispatchEvent(new Event("keydown"));
    vi.setSystemTime(10_000);
    inputTarget.dispatchEvent(new Event("keydown"));

    expect(runtime.connect).toHaveBeenCalledOnce();
    expect(runtime.connect).toHaveBeenCalledWith({ name: WALLET_UI_PORT_NAME });
    expect(port.postMessage.mock.calls).toEqual([
      [{ type: "request", id: 1, method: "getStatus" }],
      [WALLET_UI_INPUT_MESSAGE],
      [WALLET_UI_INPUT_MESSAGE],
    ]);

    connection.stopInputReporting();
    vi.setSystemTime(20_000);
    inputTarget.dispatchEvent(new Event("pointerdown"));
    expect(port.postMessage).toHaveBeenCalledTimes(3);
  });

  it("settles pending and future calls permanently without reconnecting", async () => {
    const { connection, inputTarget, port, runtime } = createHarness();
    const pending = connection.wallet.getStatus();

    port.disconnect();
    inputTarget.dispatchEvent(new Event("pointerdown"));

    await expect(pending).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    await expect(connection.wallet.getStatus()).rejects.toBeInstanceOf(WalletChannelDisconnectedError);
    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(runtime.connect).toHaveBeenCalledOnce();
  });
});
