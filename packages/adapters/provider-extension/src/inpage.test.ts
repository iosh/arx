import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL } from "./constants.js";
import { InpageTransport } from "./inpage.js";

describe("InpageTransport handshake/disconnect", () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://dapp.test" });
    (global as any).window = dom.window as unknown as Window;
    (global as any).document = dom.window.document;
    // Ensure event constructors are from JSDOM window
    (global as any).MessageEvent = dom.window.MessageEvent;
  });

  const dispatchHandshakeAck = (payload: any) => {
    const event = new MessageEvent("message", {
      data: { channel: CHANNEL, type: "handshake_ack", payload },
      source: window as MessageEventSource,
      origin: window.location.origin,
    });
    window.dispatchEvent(event);
  };

  const dispatchDisconnectEvent = (error?: unknown) => {
    const event = new MessageEvent("message", {
      data: { channel: CHANNEL, type: "event", payload: { event: "disconnect", params: error ? [error] : [] } },
      source: window as MessageEventSource,
      origin: window.location.origin,
    });
    window.dispatchEvent(event);
  };

  it("returns empty state before handshake", () => {
    const t = new InpageTransport();
    expect(t.getConnectionState()).toEqual({
      connected: false,
      chainId: null,
      caip2: null,
      accounts: [],
      isUnlocked: null,
      meta: null,
    });
  });

  it("handles handshake_ack and marks connected", async () => {
    const t = new InpageTransport();

    // Wait for connect event to ensure handshake is complete
    const connectPromise = new Promise<void>((resolve) => {
      t.once("connect", () => resolve());
    });

    // Manually construct MessageEvent with proper source in JSDOM
    const messageData = {
      channel: CHANNEL,
      type: "handshake_ack",
      payload: {
        chainId: "0x1",
        caip2: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: {
          activeChain: "eip155:1",
          activeNamespace: "eip155",
          supportedChains: ["eip155:1"],
        },
      },
    };

    // Create event using JSDOM's MessageEvent constructor
    const event = new MessageEvent("message", {
      data: messageData,
      source: window as MessageEventSource,
      origin: window.location.origin,
    });

    // Dispatch the event
    window.dispatchEvent(event);

    // Wait for the connect event to fire
    await connectPromise;

    const state = t.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.chainId).toBe("0x1");
    expect(state.accounts).toEqual(["0xabc"]);
    expect(state.caip2).toBe("eip155:1");
  });

  it("rejects pending request on disconnect", async () => {
    const t = new InpageTransport();

    window.postMessage(
      {
        channel: CHANNEL,
        type: "handshake_ack",
        payload: {
          chainId: "0x1",
          caip2: "eip155:1",
          accounts: [],
          isUnlocked: true,
          meta: {
            activeChain: "eip155:1",
            activeNamespace: "eip155",
            supportedChains: ["eip155:1"],
          },
        },
      },
      "*",
    );
    await Promise.resolve();

    const reqPromise = t.request({ method: "eth_chainId" }).catch((err) => err);

    window.postMessage(
      {
        channel: CHANNEL,
        type: "event",
        payload: { event: "disconnect", params: [] },
      },
      "*",
    );

    const err = await reqPromise;
    expect(err).toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);
  });

  it("reconnects after disconnect when handshake_ack is replayed", async () => {
    const t = new InpageTransport();

    const firstConnect = new Promise<void>((resolve) => t.once("connect", () => resolve()));

    const initialPayload = {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
      meta: {
        activeChain: "eip155:1",
        activeNamespace: "eip155",
        supportedChains: ["eip155:1"],
      },
    };
    dispatchHandshakeAck(initialPayload);
    await firstConnect;

    const pending = t.request({ method: "eth_chainId" }).catch((err) => err);

    const disconnectError = { code: 4900, message: "disconnected" };
    dispatchDisconnectEvent(disconnectError);

    const rejected = await pending;
    expect(rejected).toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);

    const reconnect = new Promise<void>((resolve) => t.once("connect", () => resolve()));
    const reconnectPayload = {
      chainId: "0x2",
      caip2: "eip155:5",
      accounts: ["0xdef"],
      isUnlocked: true,
      meta: {
        activeChain: "eip155:5",
        activeNamespace: "eip155",
        supportedChains: ["eip155:5"],
      },
    };
    dispatchHandshakeAck(reconnectPayload);

    await reconnect;
    const state = t.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.chainId).toBe("0x2");
    expect(state.caip2).toBe("eip155:5");
    expect(state.accounts).toEqual(["0xdef"]);
    expect(state.meta?.activeChain).toBe("eip155:5");
    expect(state.isUnlocked).toBe(true);
  });

  it("replays handshake_ack to refresh connection state when already connected", async () => {
    const t = new InpageTransport();
    let connectCount = 0;
    t.on("connect", () => {
      connectCount += 1;
    });

    const initialPayload = {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
      meta: {
        activeChain: "eip155:1",
        activeNamespace: "eip155",
        supportedChains: ["eip155:1", "eip155:5"],
      },
    };
    dispatchHandshakeAck(initialPayload);
    await Promise.resolve();
    expect(connectCount).toBe(1);

    const updatedPayload = {
      chainId: "0x3",
      caip2: "eip155:56",
      accounts: ["0x999"],
      isUnlocked: true,
      meta: {
        activeChain: "eip155:56",
        activeNamespace: "eip155",
        supportedChains: ["eip155:56"],
      },
    };
    dispatchHandshakeAck(updatedPayload);
    await Promise.resolve();

    expect(connectCount).toBe(2);
    const state = t.getConnectionState();
    expect(state.chainId).toBe("0x3");
    expect(state.caip2).toBe("eip155:56");
    expect(state.accounts).toEqual(["0x999"]);
    expect(state.meta?.supportedChains).toEqual(["eip155:56"]);
  });

  it("times out connect() when handshake_ack never arrives", async () => {
    const t = new InpageTransport({ handshakeTimeoutMs: 20 });

    await expect(t.connect()).rejects.toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);
  });

  it("dedupes inflight connect() calls and posts one handshake", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const t = new InpageTransport({ handshakeTimeoutMs: 1_000 });

    const p1 = t.connect().catch((err) => err);
    const p2 = t.connect().catch((err) => err);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy.mock.calls[0]?.[0]).toMatchObject({ channel: CHANNEL, type: "handshake" });

    await t.disconnect();
    await Promise.all([p1, p2]);

    postMessageSpy.mockRestore();
  });

  it("retryConnect() resends handshake while inflight", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const t = new InpageTransport({ handshakeTimeoutMs: 1_000 });

    const p1 = t.connect().catch((err) => err);
    const p2 = t.retryConnect().catch((err) => err);

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
    expect(postMessageSpy.mock.calls[0]?.[0]).toMatchObject({ channel: CHANNEL, type: "handshake" });
    expect(postMessageSpy.mock.calls[1]?.[0]).toMatchObject({ channel: CHANNEL, type: "handshake" });

    await t.disconnect();
    await Promise.all([p1, p2]);

    postMessageSpy.mockRestore();
  });

  it("accepts late handshake_ack after connect() timeout", async () => {
    const t = new InpageTransport({ handshakeTimeoutMs: 20 });

    await expect(t.connect()).rejects.toMatchObject({ code: 4900 });

    const connected = new Promise<void>((resolve) => t.once("connect", () => resolve()));
    dispatchHandshakeAck({
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });

    await connected;
    expect(t.isConnected()).toBe(true);
    expect(t.getConnectionState().chainId).toBe("0x1");
  });

  it("allows reconnect after a timeout via a new connect()", async () => {
    const t = new InpageTransport({ handshakeTimeoutMs: 20 });

    await expect(t.connect()).rejects.toMatchObject({ code: 4900 });

    const pending = t.connect();
    dispatchHandshakeAck({
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });

    await expect(pending).resolves.toBeUndefined();
    expect(t.isConnected()).toBe(true);
    expect(t.getConnectionState().accounts).toEqual(["0xabc"]);
  });
});
