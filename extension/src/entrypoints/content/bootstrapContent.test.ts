import { CHANNEL, PROTOCOL_VERSION, PROVIDER_EVENTS } from "@arx/provider/protocol";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { bootstrapContent } from "./bootstrapContent";

type Listener<T> = (payload: T) => void;

class FakePort {
  name = CHANNEL;
  sender: unknown = {};
  postMessage = vi.fn();
  disconnect = vi.fn();

  #messageListeners = new Set<Listener<unknown>>();
  #disconnectListeners = new Set<() => void>();

  onMessage = {
    addListener: (fn: Listener<unknown>) => this.#messageListeners.add(fn),
    removeListener: (fn: Listener<unknown>) => this.#messageListeners.delete(fn),
  };

  onDisconnect = {
    addListener: (fn: () => void) => this.#disconnectListeners.add(fn),
    removeListener: (fn: () => void) => this.#disconnectListeners.delete(fn),
  };

  triggerMessage(msg: unknown) {
    for (const fn of this.#messageListeners) fn(msg);
  }

  triggerDisconnect() {
    for (const fn of this.#disconnectListeners) fn();
  }
}

const createDom = (url = "https://dapp.test") => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });

  const g = globalThis as unknown as Record<string, unknown>;
  const prev = {
    window: g.window,
    document: g.document,
    Event: g.Event,
    MessageEvent: g.MessageEvent,
  };

  g.window = dom.window as unknown as Window;
  g.document = dom.window.document;
  g.Event = dom.window.Event;
  g.MessageEvent = dom.window.MessageEvent;

  const restoreKey = (key: keyof typeof prev) => {
    if (prev[key] === undefined) {
      delete g[key];
      return;
    }
    g[key] = prev[key] as unknown;
  };

  return {
    dom,
    teardown: () => {
      restoreKey("MessageEvent");
      restoreKey("Event");
      restoreKey("document");
      restoreKey("window");
      dom.window.close();
    },
  };
};

const dispatchWindowMessage = (data: unknown) => {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data,
      source: window as unknown as Window,
      origin: window.location.origin,
    }),
  );
};

vi.mock("webextension-polyfill", () => {
  return {
    __esModule: true,
    default: {
      runtime: {
        connect: vi.fn(),
      },
    },
  };
});

describe("bootstrapContent", () => {
  let port: FakePort;
  let connectSpy: ReturnType<typeof vi.fn>;
  let _ctx: ReturnType<typeof createDom>;

  beforeEach(async () => {
    _ctx = createDom();
    port = new FakePort();

    const mod = (await import("webextension-polyfill")) as unknown as { default: { runtime: { connect: unknown } } };
    connectSpy = vi.fn(() => port as unknown as Runtime.Port);
    mod.default.runtime.connect = connectSpy;
  });

  it("does not connect eagerly; connects on handshake and forwards to background", () => {
    const postSpy = vi.spyOn(window, "postMessage");

    bootstrapContent();

    expect(connectSpy).toHaveBeenCalledTimes(0);

    dispatchWindowMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { protocolVersion: PROTOCOL_VERSION, handshakeId: "h1" },
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL, sessionId: "s1", type: "handshake" }),
    );

    port.triggerDisconnect();

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: CHANNEL,
        sessionId: "s1",
        type: "event",
        payload: { event: PROVIDER_EVENTS.disconnect, params: [{ code: 4900, message: "Disconnected" }] },
      }),
      window.location.origin,
    );
  });

  it("ignores request before handshake", () => {
    bootstrapContent();

    dispatchWindowMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "request",
      id: "m1",
      payload: { jsonrpc: "2.0", id: "1", method: "eth_chainId" },
    });

    expect(connectSpy).toHaveBeenCalledTimes(0);
    expect(port.postMessage).toHaveBeenCalledTimes(0);
  });
});
