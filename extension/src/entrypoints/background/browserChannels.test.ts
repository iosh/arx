import type { DuplexChannel } from "@arx/message-channel";
import { describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { DAPP_PROVIDER_PORT_NAME, WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";
import { WALLET_UI_INPUT_MESSAGE } from "@/platform/browser/walletUiInput";
import { acceptBrowserPort, type PendingBrowserPort } from "./browserChannels";

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

class FakePort {
  readonly name: string;
  readonly sender: Runtime.MessageSender | undefined;
  readonly postMessage = vi.fn<(message: unknown) => void>();
  readonly #messageListeners = new Set<MessageListener>();
  readonly #disconnectListeners = new Set<DisconnectListener>();

  constructor(input: Readonly<{ name: string; sender?: Runtime.MessageSender }>) {
    this.name = input.name;
    this.sender = input.sender;
  }

  readonly onMessage = {
    addListener: (listener: MessageListener) => this.#messageListeners.add(listener),
    removeListener: (listener: MessageListener) => this.#messageListeners.delete(listener),
  };

  readonly onDisconnect = {
    addListener: (listener: DisconnectListener) => this.#disconnectListeners.add(listener),
    removeListener: (listener: DisconnectListener) => this.#disconnectListeners.delete(listener),
  };

  readonly disconnect = vi.fn(() => {
    for (const listener of [...this.#disconnectListeners]) {
      listener();
    }
  });

  receive(message: unknown): void {
    for (const listener of [...this.#messageListeners]) {
      listener(message);
    }
  }
}

const requirePendingPort = (pendingPort: PendingBrowserPort | null): PendingBrowserPort => {
  if (!pendingPort) {
    throw new Error("Expected the browser port to be accepted.");
  }
  return pendingPort;
};

const createHosts = () => {
  const walletMessages: unknown[] = [];
  const dappMessages: unknown[] = [];
  const walletDisconnected = vi.fn();
  const walletAttach = vi.fn((channel: DuplexChannel) => {
    channel.onMessage((message) => walletMessages.push(message));
    channel.onDisconnect(walletDisconnected);
  });
  const dappAttach = vi.fn((input: Readonly<{ channel: DuplexChannel; origin: string }>) => {
    input.channel.onMessage((message) => dappMessages.push(message));
  });

  return {
    hosts: {
      wallet: { attach: walletAttach },
      dapp: { attach: dappAttach },
    },
    walletAttach,
    dappAttach,
    walletMessages,
    dappMessages,
    walletDisconnected,
  };
};

const accept = (port: FakePort, onWalletUiInput = vi.fn()) => ({
  pendingPort: acceptBrowserPort({
    port: port as unknown as Runtime.Port,
    extensionUrl: "chrome-extension://arx/",
    runtimeId: "arx",
    onWalletUiInput,
  }),
  onWalletUiInput,
});

describe("background browser channels", () => {
  it("queues provider messages without treating dapp traffic as Wallet UI input", () => {
    const port = new FakePort({
      name: DAPP_PROVIDER_PORT_NAME,
      sender: {
        id: "arx",
        url: "https://Frame.Example:443/path?query=1",
        tab: { url: "https://top-level.example" } as Runtime.MessageSender["tab"],
      },
    });
    const { pendingPort, onWalletUiInput } = accept(port);
    const attachment = createHosts();
    const open = { type: "open", namespace: "eip155" };

    port.receive(WALLET_UI_INPUT_MESSAGE);
    port.receive(open);
    expect(attachment.dappAttach).not.toHaveBeenCalled();

    requirePendingPort(pendingPort).attach(attachment.hosts);

    expect(attachment.dappAttach).toHaveBeenCalledWith({
      channel: expect.objectContaining({
        send: expect.any(Function),
        onMessage: expect.any(Function),
        onDisconnect: expect.any(Function),
      }),
      origin: "https://frame.example",
    });
    expect(attachment.dappMessages).toEqual([WALLET_UI_INPUT_MESSAGE, open]);
    expect(onWalletUiInput).not.toHaveBeenCalled();
    expect(attachment.walletAttach).not.toHaveBeenCalled();
  });

  it("rejects provider ports without trusted HTTP(S) sender metadata instead of using tab.url", () => {
    const cases: Array<Runtime.MessageSender | undefined> = [
      undefined,
      { id: "other", url: "https://dapp.test" },
      { id: "arx", tab: { url: "https://top-level.example" } as Runtime.MessageSender["tab"] },
      { id: "arx", url: "file:///tmp/dapp.html" },
      { id: "arx", url: "chrome-extension://arx/popup.html" },
      { id: "arx", url: "not a url" },
    ];

    for (const sender of cases) {
      const port = new FakePort({ name: DAPP_PROVIDER_PORT_NAME, sender });

      expect(accept(port).pendingPort).toBeNull();
      expect(port.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("publishes pending and live input only from an authenticated Wallet UI port", () => {
    const port = new FakePort({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    const { pendingPort, onWalletUiInput } = accept(port);
    const attachment = createHosts();
    const firstRequest = { type: "request", id: 1, method: "getStatus" };

    port.receive(WALLET_UI_INPUT_MESSAGE);
    port.receive(firstRequest);

    expect(onWalletUiInput).not.toHaveBeenCalled();
    expect(attachment.walletAttach).not.toHaveBeenCalled();

    requirePendingPort(pendingPort).attach(attachment.hosts);

    expect(onWalletUiInput).toHaveBeenCalledOnce();
    expect(attachment.walletMessages).toEqual([firstRequest]);

    const secondRequest = { type: "request", id: 2, method: "accounts.list" };
    port.receive(WALLET_UI_INPUT_MESSAGE);
    port.receive(secondRequest);

    expect(onWalletUiInput).toHaveBeenCalledTimes(2);
    expect(attachment.walletMessages).toEqual([firstRequest, secondRequest]);
    expect(attachment.dappAttach).not.toHaveBeenCalled();
  });

  it("rejects Wallet UI ports without this extension's real sender URL", () => {
    const untrustedPorts = [
      new FakePort({ name: WALLET_UI_PORT_NAME, sender: { id: "other", url: "chrome-extension://arx/popup.html" } }),
      new FakePort({ name: WALLET_UI_PORT_NAME, sender: { id: "arx", url: "https://dapp.test" } }),
      new FakePort({ name: WALLET_UI_PORT_NAME }),
    ];

    for (const port of untrustedPorts) {
      expect(accept(port).pendingPort).toBeNull();
      expect(port.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("replays an early disconnect after pending Wallet messages", () => {
    const port = new FakePort({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    const pendingPort = requirePendingPort(accept(port).pendingPort);
    const attachment = createHosts();
    const request = { type: "request", id: 1, method: "getStatus" };

    port.receive(request);
    port.disconnect();
    pendingPort.attach(attachment.hosts);

    expect(attachment.walletMessages).toEqual([request]);
    expect(attachment.walletDisconnected).toHaveBeenCalledOnce();
  });

  it("drops pending messages and disconnects a port when background boot fails", () => {
    const port = new FakePort({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    const pendingPort = requirePendingPort(accept(port).pendingPort);
    const attachment = createHosts();

    port.receive({ type: "request", id: 1, method: "getStatus" });
    pendingPort.reject();
    pendingPort.attach(attachment.hosts);

    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(attachment.walletAttach).not.toHaveBeenCalled();
  });
});
