/* @vitest-environment jsdom */
/* @vitest-environment-options {"url":"https://dapp.test"} */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNEL, PROTOCOL_VERSION } from "../protocol/index.js";
import { WindowPostMessageTransport } from "./windowPostMessageTransport.js";

describe("WindowPostMessageTransport", () => {
  const instances: WindowPostMessageTransport[] = [];
  const createTransport = () => {
    const instance = new WindowPostMessageTransport();
    instances.push(instance);
    return instance;
  };

  afterEach(async () => {
    vi.useRealTimers();
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

  const getRequestsFromSpy = (postMessageSpy: ReturnType<typeof vi.spyOn>) => {
    const calls = postMessageSpy.mock.calls as Array<Parameters<Window["postMessage"]>>;
    return calls
      .map(([candidate]) => candidate as any)
      .filter((msg) => msg?.channel === CHANNEL && msg?.type === "request")
      .map((requestEnvelope) => {
        const sessionId = requestEnvelope.sessionId as unknown;
        const id = requestEnvelope.id as unknown;
        expect(typeof sessionId).toBe("string");
        expect(typeof id).toBe("string");
        return { sessionId: sessionId as string, id: id as string };
      });
  };

  const dispatchEnvelope = (
    envelope: unknown,
    options?: Partial<{ origin: string; source: MessageEventSource | null }>,
  ) => {
    const hasSource = options ? Object.hasOwn(options, "source") : false;
    const source: MessageEventSource | null | undefined = hasSource
      ? options?.source
      : (window as unknown as MessageEventSource);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: envelope,
        source,
        origin: options?.origin ?? window.location.origin,
      }),
    );
  };

  const dispatchHandshakeAck = (
    sessionId: string,
    handshakeId: string,
    payload: any,
    options?: { protocolVersion?: number | null },
  ) => {
    const protocolVersion = options?.protocolVersion ?? PROTOCOL_VERSION;
    dispatchEnvelope({
      channel: CHANNEL,
      sessionId,
      type: "handshake_ack",
      payload: { ...payload, ...(protocolVersion === null ? {} : { protocolVersion }), handshakeId },
    });
  };

  const dispatchDisconnectEvent = (sessionId: string, error?: unknown) => {
    dispatchEnvelope({
      channel: CHANNEL,
      sessionId,
      type: "event",
      payload: { event: "disconnect", params: error ? [error] : [] },
    });
  };

  const connectWithHandshakeAck = async (t: WindowPostMessageTransport, options?: { accounts?: string[] }) => {
    const postMessageSpy = vi.spyOn(window, "postMessage");
    const pendingConnect = t.connect();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
    dispatchHandshakeAck(sessionId, handshakeId, {
      chainId: "0x1",
      chainRef: "eip155:1",
      accounts: options?.accounts ?? [],
      isUnlocked: true,
      meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
    });
    await pendingConnect;
    postMessageSpy.mockRestore();
    return { sessionId };
  };

  describe("handshake", () => {
    it("returns empty state before handshake", () => {
      const t = createTransport();
      expect(t.getConnectionState()).toEqual({
        connected: false,
        chainId: null,
        chainRef: null,
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
        chainRef: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
      });

      await expect(pendingConnect).resolves.toBeUndefined();

      const state = t.getConnectionState();
      expect(state.connected).toBe(true);
      expect(state.chainId).toBe("0x1");
      expect(state.accounts).toEqual(["0xabc"]);
      expect(state.chainRef).toBe("eip155:1");
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
          chainRef: "eip155:1",
          accounts: ["0xabc"],
          isUnlocked: true,
          meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
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
          chainRef: "eip155:1",
          accounts: ["0xabc"],
          isUnlocked: true,
          meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
        },
        { protocolVersion: 999 },
      );

      await expect(pendingConnect).rejects.toMatchObject({ code: 4900 });
      expect(t.isConnected()).toBe(false);
      postMessageSpy.mockRestore();
    });

    it("ignores malformed handshake_ack payload without crashing", async () => {
      vi.useFakeTimers();
      try {
        const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
        instances.push(t);

        const postMessageSpy = vi.spyOn(window, "postMessage");
        const pendingConnect = t.connect().catch((err) => err);
        const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

        // missing meta/isUnlocked/etc: should be ignored by guards, then timeout
        dispatchEnvelope({
          channel: CHANNEL,
          sessionId,
          type: "handshake_ack",
          payload: { protocolVersion: PROTOCOL_VERSION, handshakeId, chainId: "0x1" },
        });

        await vi.advanceTimersByTimeAsync(25);
        await expect(pendingConnect).resolves.toMatchObject({ code: 4900 });
        postMessageSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores handshake_ack when no connect() is inflight", async () => {
      const t = createTransport();
      dispatchHandshakeAck("not-a-real-session", "not-a-real-handshake", {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
      });
      await Promise.resolve();
      expect(t.isConnected()).toBe(false);
    });

    it("times out connect() when handshake_ack never arrives", async () => {
      vi.useFakeTimers();
      try {
        const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
        instances.push(t);
        const pending = t.connect().catch((err) => err);
        await vi.advanceTimersByTimeAsync(25);
        await expect(pending).resolves.toMatchObject({ code: 4900 });
        expect(t.isConnected()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
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
      vi.useFakeTimers();
      try {
        const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
        instances.push(t);

        const pending = t.connect().catch((err) => err);
        await vi.advanceTimersByTimeAsync(25);
        await expect(pending).resolves.toMatchObject({ code: 4900 });

        dispatchHandshakeAck("stale-session", "stale", {
          chainId: "0x1",
          chainRef: "eip155:1",
          accounts: [],
          isUnlocked: true,
          meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
        });
        await Promise.resolve();
        expect(t.isConnected()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows reconnect after a timeout via a new connect()", async () => {
      vi.useFakeTimers();
      try {
        const t = new WindowPostMessageTransport({ handshakeTimeoutMs: 20 });
        instances.push(t);
        const postMessageSpy = vi.spyOn(window, "postMessage");

        const first = t.connect().catch((err) => err);
        await vi.advanceTimersByTimeAsync(25);
        await expect(first).resolves.toMatchObject({ code: 4900 });

        const pending = t.connect();
        const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
        dispatchHandshakeAck(sessionId, handshakeId, {
          chainId: "0x1",
          chainRef: "eip155:1",
          accounts: ["0xabc"],
          isUnlocked: true,
          meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
        });

        await expect(pending).resolves.toBeUndefined();
        expect(t.isConnected()).toBe(true);
        expect(t.getConnectionState().accounts).toEqual(["0xabc"]);
        postMessageSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("filters (origin/source/sessionId)", () => {
    it("ignores responses when origin mismatches", async () => {
      vi.useFakeTimers();
      try {
        const t = createTransport();
        const { sessionId } = await connectWithHandshakeAck(t);

        const postMessageSpy = vi.spyOn(window, "postMessage");
        const pending = t.request({ method: "eth_chainId" }, { timeoutMs: 20 }).catch((err) => err);
        const [{ id }] = getRequestsFromSpy(postMessageSpy);

        dispatchEnvelope(
          { channel: CHANNEL, sessionId, type: "response", id, payload: { jsonrpc: "2.0", id, result: "0x1" } },
          { origin: "https://evil.test" },
        );

        await vi.advanceTimersByTimeAsync(25);
        await expect(pending).resolves.toMatchObject({ code: -32603 });
        postMessageSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores responses when source mismatches", async () => {
      vi.useFakeTimers();
      try {
        const t = createTransport();
        const { sessionId } = await connectWithHandshakeAck(t);

        const postMessageSpy = vi.spyOn(window, "postMessage");
        const pending = t.request({ method: "eth_chainId" }, { timeoutMs: 20 }).catch((err) => err);
        const [{ id }] = getRequestsFromSpy(postMessageSpy);

        dispatchEnvelope(
          { channel: CHANNEL, sessionId, type: "response", id, payload: { jsonrpc: "2.0", id, result: "0x1" } },
          { source: {} as unknown as MessageEventSource },
        );

        await vi.advanceTimersByTimeAsync(25);
        await expect(pending).resolves.toMatchObject({ code: -32603 });
        postMessageSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores events from a stale sessionId (replay protection)", async () => {
      const t = createTransport();

      const postMessageSpy = vi.spyOn(window, "postMessage");
      const firstConnect = t.connect();
      const firstHandshake = getHandshakeFromSpy(postMessageSpy);
      dispatchHandshakeAck(firstHandshake.sessionId, firstHandshake.handshakeId, {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
      });
      await firstConnect;

      dispatchDisconnectEvent(firstHandshake.sessionId);
      expect(t.isConnected()).toBe(false);

      const secondConnect = t.connect();
      const secondHandshake = getHandshakeFromSpy(postMessageSpy);
      dispatchHandshakeAck(secondHandshake.sessionId, secondHandshake.handshakeId, {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: [],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
      });
      await secondConnect;
      expect(t.isConnected()).toBe(true);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId: firstHandshake.sessionId,
        type: "event",
        payload: { event: "accountsChanged", params: [["0xdead"]] },
      });

      expect(t.getConnectionState().accounts).toEqual([]);
      postMessageSpy.mockRestore();
    });
  });

  describe("request/response", () => {
    it("honors per-request timeout override", async () => {
      vi.useFakeTimers();
      try {
        const t = createTransport();
        await connectWithHandshakeAck(t);
        const pending = t.request({ method: "eth_chainId" }, { timeoutMs: 20 }).catch((err) => err);
        await vi.advanceTimersByTimeAsync(25);
        await expect(pending).resolves.toMatchObject({ code: -32603 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("matches out-of-order responses to the correct pending requests", async () => {
      const t = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");

      const pendingConnect = t.connect();
      const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
      dispatchHandshakeAck(sessionId, handshakeId, {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: [],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
      });
      await pendingConnect;

      const p1 = t.request({ method: "eth_chainId" }) as Promise<unknown>;
      const p2 = t.request({ method: "eth_accounts" }) as Promise<unknown>;

      const requests = getRequestsFromSpy(postMessageSpy);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      const r1 = requests.at(-2)!;
      const r2 = requests.at(-1)!;

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "response",
        id: r2.id,
        payload: { jsonrpc: "2.0", id: r2.id, result: ["0xabc"] },
      });
      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "response",
        id: r1.id,
        payload: { jsonrpc: "2.0", id: r1.id, result: "0x1" },
      });

      await expect(p1).resolves.toBe("0x1");
      await expect(p2).resolves.toEqual(["0xabc"]);
      postMessageSpy.mockRestore();
    });
  });

  describe("disconnect", () => {
    it("rejects pending request on disconnect", async () => {
      const t = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");

      const pendingConnect = t.connect();
      const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
      dispatchHandshakeAck(sessionId, handshakeId, {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: [],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
      });
      await pendingConnect;

      const reqPromise = t.request({ method: "eth_chainId" }).catch((err) => err);
      dispatchDisconnectEvent(sessionId);

      const err = await reqPromise;
      expect(err).toMatchObject({ code: 4900 });
      expect(t.isConnected()).toBe(false);
      postMessageSpy.mockRestore();
    });

    it("rejects all pending requests on disconnect", async () => {
      const t = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");
      const { sessionId } = await connectWithHandshakeAck(t);

      const p1 = t.request({ method: "eth_chainId" }).catch((err) => err);
      const p2 = t.request({ method: "eth_accounts" }).catch((err) => err);
      const p3 = t.request({ method: "eth_chainId" }).catch((err) => err);

      dispatchDisconnectEvent(sessionId);

      await expect(Promise.all([p1, p2, p3])).resolves.toEqual([
        expect.objectContaining({ code: 4900 }),
        expect.objectContaining({ code: 4900 }),
        expect.objectContaining({ code: 4900 }),
      ]);
      postMessageSpy.mockRestore();
    });

    it("reconnects after disconnect when handshake_ack is replayed", async () => {
      const t = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");

      const initialPayload = {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: { activeChain: "eip155:1", activeNamespace: "eip155", supportedChains: ["eip155:1"] },
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
        chainRef: "eip155:5",
        accounts: ["0xdef"],
        isUnlocked: true,
        meta: { activeChain: "eip155:5", activeNamespace: "eip155", supportedChains: ["eip155:5"] },
      };
      dispatchHandshakeAck(secondHandshake.sessionId, secondHandshake.handshakeId, reconnectPayload);

      await reconnect;
      const state = t.getConnectionState();
      expect(state.connected).toBe(true);
      expect(state.chainId).toBe("0x2");
      expect(state.chainRef).toBe("eip155:5");
      expect(state.accounts).toEqual(["0xdef"]);
      expect(state.meta?.activeChain).toBe("eip155:5");
      expect(state.isUnlocked).toBe(true);

      postMessageSpy.mockRestore();
    });
  });
});
