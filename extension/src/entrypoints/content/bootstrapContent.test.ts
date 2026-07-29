import type { WalletToPageMessage } from "@arx/provider/protocol";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import {
  createContentToPageMessage,
  createPageToContentMessage,
  readContentToPageMessage,
} from "@/channels/inpageProviderChannel";
import { DAPP_PROVIDER_PORT_NAME } from "@/channels/portNames";
import { bootstrapContent } from "./bootstrapContent";

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

describe("bootstrapContent", () => {
  let dom: JSDOM;
  let targetWindow: TestWindow;
  let postToPage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://dapp.test/frame" });
    targetWindow = dom.window as unknown as TestWindow;
    postToPage = vi.spyOn(targetWindow, "postMessage").mockImplementation(() => undefined);
  });

  afterEach(() => {
    dom.window.close();
  });

  it("filters the window relay by source, load origin, direction, and Provider protocol", () => {
    const port = new FakePort();
    const connectProviderPort = vi.fn(() => port as unknown as Runtime.Port);
    bootstrapContent({ targetWindow, connectProviderPort });

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
    expect(port.postMessage).toHaveBeenCalledWith({ type: "open", namespace: "eip155" });
  });

  it("uses one Runtime.Port for every namespace in the frame", () => {
    const port = new FakePort();
    const connectProviderPort = vi.fn(() => port as unknown as Runtime.Port);
    bootstrapContent({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
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

  it("relays decoded Wallet-to-Page Provider messages from background", () => {
    const port = new FakePort();
    bootstrapContent({ targetWindow, connectProviderPort: () => port as unknown as Runtime.Port });
    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
    postToPage.mockClear();

    const opened = {
      type: "opened",
      namespace: "eip155",
      connection: { chainRef: "eip155:1", accounts: [] },
    } as const;
    port.receive(opened);

    expect(postToPage).toHaveBeenCalledWith(createContentToPageMessage(opened), targetWindow.location.origin);
  });

  it("settles page requests on disconnect and recovers once by resending only opened namespaces", () => {
    const firstPort = new FakePort();
    const recoveredPort = new FakePort();
    const connectProviderPort = vi
      .fn<() => Runtime.Port>()
      .mockReturnValueOnce(firstPort as unknown as Runtime.Port)
      .mockReturnValueOnce(recoveredPort as unknown as Runtime.Port);
    bootstrapContent({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
    dispatchPageMessage(targetWindow, { type: "open", namespace: "conflux" });
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

    recoveredPort.loseConnection();

    expect(connectProviderPort).toHaveBeenCalledTimes(2);
    expect(postToPage).toHaveBeenCalledTimes(2);
  });

  it("treats a synchronous port send failure as disconnect without replaying the failed request", () => {
    const firstPort = new FakePort();
    const recoveredPort = new FakePort();
    firstPort.postMessage.mockImplementation((message) => {
      if ((message as { type?: unknown }).type === "request") {
        throw new Error("disconnected");
      }
    });
    const connectProviderPort = vi
      .fn<() => Runtime.Port>()
      .mockReturnValueOnce(firstPort as unknown as Runtime.Port)
      .mockReturnValueOnce(recoveredPort as unknown as Runtime.Port);
    bootstrapContent({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
    postToPage.mockClear();
    dispatchPageMessage(targetWindow, {
      type: "request",
      namespace: "eip155",
      id: 8,
      method: "eth_chainId",
    });

    expect(firstPort.disconnect).toHaveBeenCalledOnce();
    expect(connectProviderPort).toHaveBeenCalledTimes(2);
    expect(recoveredPort.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: "open", namespace: "eip155" },
    ]);
    expect(postToPage).toHaveBeenCalledOnce();
  });

  it("reports an initial connection failure without retrying", () => {
    const connectProviderPort = vi.fn(() => {
      throw new Error("extension context invalidated");
    });
    bootstrapContent({ targetWindow, connectProviderPort });

    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });
    dispatchPageMessage(targetWindow, { type: "open", namespace: "eip155" });

    expect(connectProviderPort).toHaveBeenCalledOnce();
    expect(postToPage).toHaveBeenCalledOnce();
  });
});
