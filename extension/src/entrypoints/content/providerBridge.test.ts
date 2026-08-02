import type { WalletToPageMessage } from "@arx/provider/protocol";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { PORT_HOST_READY_MESSAGE } from "@/transport/browserPort";
import {
  createContentToPageMessage,
  createPageToContentMessage,
  readContentToPageMessage,
} from "@/transport/inpageProviderChannel";
import { DAPP_PROVIDER_PORT_NAME } from "@/transport/portNames";
import { installProviderBridge } from "./providerBridge";

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      connect: vi.fn(),
    },
  },
}));

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;
type TestWindow = Window & { MessageEvent: typeof MessageEvent };

class FakePort {
  readonly name = DAPP_PROVIDER_PORT_NAME;
  postMessage = vi.fn<(message: unknown) => void>();
  disconnect = vi.fn();
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

  loseConnection(): void {
    for (const listener of [...this.#disconnectListeners]) listener();
  }
}

const dispatchPageMessage = (
  targetWindow: TestWindow,
  message: unknown,
  overrides: Readonly<{
    source?: MessageEventSource | null;
    origin?: string;
    direction?: "page-to-content" | "content-to-page";
  }> = {},
): void => {
  const channelMessage =
    overrides.direction === "content-to-page"
      ? createContentToPageMessage(message)
      : createPageToContentMessage(message);

  targetWindow.dispatchEvent(
    new targetWindow.MessageEvent("message", {
      data: channelMessage,
      source: overrides.source === undefined ? targetWindow : overrides.source,
      origin: overrides.origin ?? targetWindow.location.origin,
    }),
  );
};

const openPortSession = async (port: FakePort): Promise<void> => {
  port.receive(PORT_HOST_READY_MESSAGE);
  await Promise.resolve();
};

describe("installProviderBridge", () => {
  let dom: JSDOM;
  let targetWindow: TestWindow;
  let postToPage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://dapp.test/" });
    targetWindow = dom.window as unknown as TestWindow;
    postToPage = vi.spyOn(targetWindow, "postMessage").mockImplementation(() => undefined);
  });

  afterEach(() => {
    dom.window.close();
  });

  it("filters the window relay by source, load origin, direction, and Provider protocol", async () => {
    const port = new FakePort();
    const connectProviderPort = vi.fn(() => port as unknown as Runtime.Port);
    installProviderBridge({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" }, { source: null });
    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" }, { origin: "https://other.test" });
    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" }, { direction: "content-to-page" });
    dispatchPageMessage(targetWindow, { type: "open", namespace: "" });
    dispatchPageMessage(targetWindow, {
      type: "opened",
      namespace: "eip155",
      connection: { chainRef: "eip155:1", accounts: [] },
    });

    expect(connectProviderPort).not.toHaveBeenCalled();

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });

    expect(connectProviderPort).toHaveBeenCalledOnce();
    expect(port.postMessage).not.toHaveBeenCalled();

    await openPortSession(port);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "open", namespace: "eip155" });

    postToPage.mockClear();
    const opened = {
      type: "opened",
      namespace: "eip155",
      connection: { chainRef: "eip155:1", accounts: [] },
    } as const;
    port.receive(opened);
    expect(postToPage).toHaveBeenCalledWith(createContentToPageMessage(opened), targetWindow.location.origin);
  });

  it("uses one browser connection for every Provider namespace", async () => {
    const port = new FakePort();
    const connectProviderPort = vi.fn(() => port as unknown as Runtime.Port);
    installProviderBridge({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
    await openPortSession(port);
    dispatchPageMessage(targetWindow, { type: "open", namespace: "conflux" });
    dispatchPageMessage(targetWindow, {
      type: "request",
      namespace: "eip155",
      id: 1,
      method: "eth_chainId",
    });

    expect(connectProviderPort).toHaveBeenCalledOnce();
    expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: "open", namespace: "eip155" },
      { type: "open", namespace: "conflux" },
      { type: "request", namespace: "eip155", id: 1, method: "eth_chainId" },
    ]);
  });

  it("recovers a disconnect by reopening namespaces without replaying RPC", async () => {
    const firstPort = new FakePort();
    const recoveredPort = new FakePort();
    const connectProviderPort = vi
      .fn<() => Runtime.Port>()
      .mockReturnValueOnce(firstPort as unknown as Runtime.Port)
      .mockReturnValueOnce(recoveredPort as unknown as Runtime.Port);
    installProviderBridge({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
    await openPortSession(firstPort);
    dispatchPageMessage(targetWindow, { type: "open", namespace: "conflux" });
    firstPort.receive({
      type: "opened",
      namespace: "eip155",
      connection: { chainRef: "eip155:1", accounts: [] },
    });
    dispatchPageMessage(targetWindow, {
      type: "request",
      namespace: "eip155",
      id: 7,
      method: "eth_getBalance",
      params: ["0xabc", "latest"],
    });
    postToPage.mockClear();

    firstPort.loseConnection();

    expect(connectProviderPort).toHaveBeenCalledTimes(2);
    expect(recoveredPort.postMessage).not.toHaveBeenCalled();

    await openPortSession(recoveredPort);
    expect(recoveredPort.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: "open", namespace: "eip155" },
      { type: "open", namespace: "conflux" },
    ]);
    expect(recoveredPort.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "request" }));

    const [windowMessage] = postToPage.mock.calls[0] ?? [];
    expect(readContentToPageMessage(windowMessage)).toEqual({
      type: "transport_disconnected",
      error: {
        kind: "disconnected",
        message: "The provider is disconnected.",
      },
    } satisfies WalletToPageMessage);
  });
});
