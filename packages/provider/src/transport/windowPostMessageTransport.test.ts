/* @vitest-environment jsdom */
/* @vitest-environment-options {"url":"https://dapp.test"} */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNEL, PROTOCOL_VERSION } from "../protocol/index.js";
import { WindowPostMessageTransport } from "./windowPostMessageTransport.js";

describe("WindowPostMessageTransport handshake/disconnect", () => {
  const instances: WindowPostMessageTransport[] = [];
  const createTransport = () => {
    const instance = new WindowPostMessageTransport();
    instances.push(instance);
    return instance;
  };

  afterEach(async () => {
    for (const instance of instances.splice(0)) {
      try {
        await instance.disconnect();
      } catch {
        // ignore cleanup failure in tests
      } finally {
        instance.destroy();
      }
    }
  });

  const getHandshakeFromSpy = (postMessageSpy: ReturnType<typeof vi.spyOn>) => {
    const calls = postMessageSpy.mock.calls as Array<Parameters<Window["postMessage"]>>;
    let handshake: unknown;

    for (let i = calls.length - 1; i >= 0; i -= 1) {
      const [candidate] = calls[i] ?? [];
      const msg = candidate as any;
      if (msg?.channel === CHANNEL && msg?.type === "handshake") {
        handshake = msg;
        break;
      }
    }

    const handshakeId = (handshake as any)?.payload?.handshakeId;
    const sessionId = (handshake as any)?.sessionId;
    expect(typeof handshakeId).toBe("string");
    expect(typeof sessionId).toBe("string");
    return { sessionId: sessionId as string, handshakeId: handshakeId as string };
  };

  const dispatchHandshakeAck = (
    sessionId: string,
    handshakeId: string,
    payload: any,
    options?: { protocolVersion?: number | null },
  ) => {
    const protocolVersion = options?.protocolVersion ?? PROTOCOL_VERSION;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          channel: CHANNEL,
          sessionId,
          type: "handshake_ack",
          payload: { ...payload, ...(protocolVersion === null ? {} : { protocolVersion }), handshakeId },
        },
        source: window as MessageEventSource,
        origin: window.location.origin,
      }),
    );
  };

  const dispatchDisconnectEvent = (sessionId: string, error?: unknown) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: { event: "disconnect", params: error ? [error] : [] },
        },
        source: window as MessageEventSource,
        origin: window.location.origin,
      }),
    );
  };

  it("returns empty state before handshake", () => {
    const t = createTransport();
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
    const t = createTransport();
    const postMessageSpy = vi.spyOn(window, "postMessage");

    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

    dispatchHandshakeAck(sessionId, handshakeId, {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
      meta: {
        activeChain: "eip155:1",
        activeNamespace: "eip155",
        supportedChains: ["eip155:1"],
      },
    });

    await expect(pendingConnect).resolves.toBeUndefined();

    const state = t.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.chainId).toBe("0x1");
    expect(state.accounts).toEqual(["0xabc"]);
    expect(state.caip2).toBe("eip155:1");
    postMessageSpy.mockRestore();
  });

  it("accepts handshake_ack without protocolVersion (defaults to v1)", async () => {
    const t = createTransport();
    const postMessageSpy = vi.spyOn(window, "postMessage");

    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

    dispatchHandshakeAck(
      sessionId,
      handshakeId,
      {
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
      { protocolVersion: null },
    );

    await expect(pendingConnect).resolves.toBeUndefined();
    expect(t.isConnected()).toBe(true);
    postMessageSpy.mockRestore();
  });

  it("rejects connect when handshake_ack has unsupported protocolVersion", async () => {
    const t = createTransport();
    const postMessageSpy = vi.spyOn(window, "postMessage");

    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

    dispatchHandshakeAck(
      sessionId,
      handshakeId,
      {
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
      { protocolVersion: 999 },
    );

    await expect(pendingConnect).rejects.toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);
    postMessageSpy.mockRestore();
  });

  it("ignores malformed handshake_ack payload without crashing", async () => {
    const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
    instances.push(t);

    const postMessageSpy = vi.spyOn(window, "postMessage");
    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

    // missing meta/isUnlocked/etc: should be ignored by guards, then timeout
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          channel: CHANNEL,
          sessionId,
          type: "handshake_ack",
          payload: { protocolVersion: PROTOCOL_VERSION, handshakeId, chainId: "0x1" },
        },
        source: window as MessageEventSource,
        origin: window.location.origin,
      }),
    );

    await expect(pendingConnect).rejects.toMatchObject({ code: 4900 });
    postMessageSpy.mockRestore();
  });

  it("rejects pending request on disconnect", async () => {
    const t = createTransport();
    const postMessageSpy = vi.spyOn(window, "postMessage");

    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
    dispatchHandshakeAck(sessionId, handshakeId, {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: {
        activeChain: "eip155:1",
        activeNamespace: "eip155",
        supportedChains: ["eip155:1"],
      },
    });
    await pendingConnect;

    const reqPromise = t.request({ method: "eth_chainId" }).catch((err) => err);
    dispatchDisconnectEvent(sessionId);

    const err = await reqPromise;
    expect(err).toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);
    postMessageSpy.mockRestore();
  });

  it("reconnects after disconnect when handshake_ack is replayed", async () => {
    const t = createTransport();
    const postMessageSpy = vi.spyOn(window, "postMessage");

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

    const firstConnect = t.connect();
    const firstHandshake = getHandshakeFromSpy(postMessageSpy);
    dispatchHandshakeAck(firstHandshake.sessionId, firstHandshake.handshakeId, initialPayload);
    await firstConnect;

    const pending = t.request({ method: "eth_chainId" }).catch((err) => err);
    const disconnectError = { code: 4900, message: "disconnected" };
    dispatchDisconnectEvent(firstHandshake.sessionId, disconnectError);

    const rejected = await pending;
    expect(rejected).toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);

    const reconnect = t.connect();
    const secondHandshake = getHandshakeFromSpy(postMessageSpy);
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
    dispatchHandshakeAck(secondHandshake.sessionId, secondHandshake.handshakeId, reconnectPayload);

    await reconnect;
    const state = t.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.chainId).toBe("0x2");
    expect(state.caip2).toBe("eip155:5");
    expect(state.accounts).toEqual(["0xdef"]);
    expect(state.meta?.activeChain).toBe("eip155:5");
    expect(state.isUnlocked).toBe(true);

    postMessageSpy.mockRestore();
  });

  it("ignores handshake_ack when no connect() is inflight", async () => {
    const t = createTransport();
    dispatchHandshakeAck("not-a-real-session", "not-a-real-handshake", {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });
    await Promise.resolve();
    expect(t.isConnected()).toBe(false);
  });

  it("times out connect() when handshake_ack never arrives", async () => {
    const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
    instances.push(t);
    await expect(t.connect()).rejects.toMatchObject({ code: 4900 });
    expect(t.isConnected()).toBe(false);
  });

  it("dedupes inflight connect() calls and posts one handshake", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 1_000 });
    instances.push(t);

    const p1 = t.connect().catch((err) => err);
    const p2 = t.connect().catch((err) => err);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy.mock.calls[0]?.[0]).toMatchObject({
      channel: CHANNEL,
      type: "handshake",
      payload: { protocolVersion: PROTOCOL_VERSION },
    });

    await t.disconnect();
    await Promise.all([p1, p2]);

    postMessageSpy.mockRestore();
  });

  it("retryConnect() resends handshake while inflight", async () => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 1_000 });
    instances.push(t);

    const p1 = t.connect().catch((err) => err);
    const p2 = t.retryConnect().catch((err) => err);

    expect(postMessageSpy).toHaveBeenCalledTimes(2);
    expect(postMessageSpy.mock.calls[0]?.[0]).toMatchObject({ channel: CHANNEL, type: "handshake" });
    expect(postMessageSpy.mock.calls[1]?.[0]).toMatchObject({ channel: CHANNEL, type: "handshake" });

    await t.disconnect();
    await Promise.all([p1, p2]);

    postMessageSpy.mockRestore();
  });

  it("ignores late handshake_ack after connect() timeout", async () => {
    const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
    instances.push(t);

    await expect(t.connect()).rejects.toMatchObject({ code: 4900 });

    dispatchHandshakeAck("stale-session", "stale", {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });
    await Promise.resolve();
    expect(t.isConnected()).toBe(false);
  });

  it("allows reconnect after a timeout via a new connect()", async () => {
    const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
    instances.push(t);
    const postMessageSpy = vi.spyOn(window, "postMessage");

    await expect(t.connect()).rejects.toMatchObject({ code: 4900 });

    const pending = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
    dispatchHandshakeAck(sessionId, handshakeId, {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });

    await expect(pending).resolves.toBeUndefined();
    expect(t.isConnected()).toBe(true);
    expect(t.getConnectionState().accounts).toEqual(["0xabc"]);
    postMessageSpy.mockRestore();
  });

  it("honors per-request timeout override", async () => {
    const t = createTransport();
    const postMessageSpy = vi.spyOn(window, "postMessage");

    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
    dispatchHandshakeAck(sessionId, handshakeId, {
      chainId: "0x1",
      caip2: "eip155:1",
      accounts: [],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });
    await pendingConnect;

    await expect(t.request({ method: "eth_chainId" }, { timeoutMs: 20 })).rejects.toMatchObject({ code: -32603 });
    postMessageSpy.mockRestore();
  });
});
