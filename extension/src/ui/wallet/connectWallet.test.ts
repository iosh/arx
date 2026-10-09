import { afterEach, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
import { PORT_HOST_READY_MESSAGE } from "@/transport/browserPort";
import { WALLET_UI_PORT_NAME } from "@/transport/portNames";
import { connectWallet } from "./connectWallet";

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

afterEach(() => vi.clearAllMocks());

it("exposes the client after the host handshake", async () => {
  const port = new FakePort();
  vi.mocked(browser.runtime.connect).mockReturnValue(port as unknown as Runtime.Port);
  const ready = connectWallet();
  expect(port.postMessage).not.toHaveBeenCalled();
  port.receive(PORT_HOST_READY_MESSAGE);
  const result = await ready;
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected a ready connection");
  const status = result.wallet.getStatus();
  port.receive({ type: "success", id: 1, result: "locked" });
  await expect(status).resolves.toBe("locked");
  expect(browser.runtime.connect).toHaveBeenCalledWith({ name: WALLET_UI_PORT_NAME });
});

it("returns a failure when disconnected before the host is ready", async () => {
  const port = new FakePort();
  vi.mocked(browser.runtime.connect).mockReturnValue(port as unknown as Runtime.Port);
  const ready = connectWallet();
  port.disconnect();
  expect(await ready).toEqual({ status: "error" });
  expect(port.postMessage).not.toHaveBeenCalled();
});
