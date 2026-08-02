import type { DuplexChannel } from "@arx/message-channel";
import { describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { PORT_HOST_READY_MESSAGE } from "@/transport/browserPort";
import { DAPP_PROVIDER_PORT_NAME, WALLET_UI_PORT_NAME } from "@/transport/portNames";
import { WALLET_UI_INPUT_MESSAGE } from "@/transport/walletUiInput";
import { handleBrowserConnection } from "./browserConnection";

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

class FakeConnection {
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
    for (const listener of [...this.#disconnectListeners]) listener();
  });

  receive(message: unknown): void {
    for (const listener of [...this.#messageListeners]) listener(message);
  }
}

const createHosts = () => ({
  wallet: { attach: vi.fn() },
  dapp: { attach: vi.fn() },
});

const handle = (
  connection: FakeConnection,
  input: Readonly<{
    hosts?: ReturnType<typeof createHosts> | Promise<ReturnType<typeof createHosts>>;
    onWalletUiInput?: () => void;
  }> = {},
) => {
  const hosts = input.hosts ?? createHosts();
  const onWalletUiInput = input.onWalletUiInput ?? vi.fn();

  return handleBrowserConnection({
    connection: connection as unknown as Runtime.Port,
    hosts: Promise.resolve(hosts),
    extensionUrl: "chrome-extension://arx/",
    runtimeId: "arx",
    onWalletUiInput,
  });
};

describe("handleBrowserConnection", () => {
  it("connects an authenticated Wallet UI after the hosts are ready", async () => {
    const connection = new FakeConnection({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    const hosts = createHosts();
    const onWalletUiInput = vi.fn();
    const handled = handle(connection, { hosts, onWalletUiInput });

    connection.receive({ type: "request", id: 1, method: "getStatus" });
    await handled;

    expect(hosts.wallet.attach).toHaveBeenCalledOnce();
    expect(connection.postMessage).toHaveBeenCalledWith(PORT_HOST_READY_MESSAGE);

    const channel = hosts.wallet.attach.mock.calls[0]?.[0] as DuplexChannel;
    const messages: unknown[] = [];
    channel.onMessage((message) => messages.push(message));
    const request = { type: "request", id: 2, method: "accounts.list" };
    connection.receive(WALLET_UI_INPUT_MESSAGE);
    connection.receive(request);

    expect(onWalletUiInput).toHaveBeenCalledOnce();
    expect(messages).toEqual([request]);
  });

  it("connects an authenticated dapp using the origin from sender.url", async () => {
    const connection = new FakeConnection({
      name: DAPP_PROVIDER_PORT_NAME,
      sender: { id: "arx", url: "https://Dapp.Example:443/path" },
    });
    const hosts = createHosts();
    await handle(connection, { hosts });

    expect(hosts.dapp.attach).toHaveBeenCalledWith({
      channel: expect.objectContaining({
        send: expect.any(Function),
        onMessage: expect.any(Function),
        onDisconnect: expect.any(Function),
      }),
      origin: "https://dapp.example",
    });
    expect(connection.postMessage).toHaveBeenCalledWith(PORT_HOST_READY_MESSAGE);
  });

  it("closes connections from unverified or unsupported senders", async () => {
    const connections = [
      new FakeConnection({
        name: WALLET_UI_PORT_NAME,
        sender: { id: "other", url: "chrome-extension://arx/popup.html" },
      }),
      new FakeConnection({ name: WALLET_UI_PORT_NAME, sender: { id: "arx", url: "https://dapp.test" } }),
      new FakeConnection({ name: DAPP_PROVIDER_PORT_NAME, sender: { id: "other", url: "https://dapp.test" } }),
      new FakeConnection({ name: DAPP_PROVIDER_PORT_NAME, sender: { id: "arx", url: "file:///tmp/dapp.html" } }),
      new FakeConnection({ name: "unsupported", sender: { id: "arx", url: "chrome-extension://arx/popup.html" } }),
    ];

    for (const connection of connections) {
      await handle(connection);
      expect(connection.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("does not attach after disconnect and closes on bootstrap failure", async () => {
    let resolveHosts: ((hosts: ReturnType<typeof createHosts>) => void) | undefined;
    const hostsPromise = new Promise<ReturnType<typeof createHosts>>((resolve) => {
      resolveHosts = resolve;
    });
    const disconnected = new FakeConnection({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    const disconnectedHosts = createHosts();
    const handled = handle(disconnected, { hosts: hostsPromise });
    disconnected.disconnect();
    resolveHosts?.(disconnectedHosts);
    await handled;

    expect(disconnectedHosts.wallet.attach).not.toHaveBeenCalled();

    const failed = new FakeConnection({
      name: WALLET_UI_PORT_NAME,
      sender: { id: "arx", url: "chrome-extension://arx/popup.html" },
    });
    await handle(failed, { hosts: Promise.reject(new Error("bootstrap failed")) });

    expect(failed.disconnect).toHaveBeenCalledOnce();
  });
});
