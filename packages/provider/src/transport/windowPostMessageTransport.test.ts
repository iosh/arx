/* @vitest-environment jsdom */
/* @vitest-environment-options {"url":"https://dapp.test"} */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eip155TransportCodec } from "../namespaces/eip155/transportCodec.js";
import { CHANNEL, PROTOCOL_VERSION, PROVIDER_EVENTS } from "../protocol/index.js";
import { WindowPostMessageTransport } from "./windowPostMessageTransport.js";

describe("WindowPostMessageTransport", () => {
  const instances: Array<{ disconnect: () => Promise<void>; destroy: () => void }> = [];
  const createTransport = (namespace = "eip155") => {
    const instance = new WindowPostMessageTransport({ namespace, codec: eip155TransportCodec });
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

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null;
  };

  const getHandshakeFromSpy = (postMessageSpy: ReturnType<typeof vi.spyOn>) => {
    const calls = postMessageSpy.mock.calls as Array<Parameters<Window["postMessage"]>>;
    let handshake: unknown;

    for (let i = calls.length - 1; i >= 0; i -= 1) {
      const [candidate] = calls[i] ?? [];
      if (isRecord(candidate) && candidate.channel === CHANNEL && candidate.type === "handshake") {
        handshake = candidate;
        break;
      }
    }

    const handshakeEnvelope = isRecord(handshake) ? handshake : null;
    const handshakePayload = isRecord(handshakeEnvelope?.payload) ? handshakeEnvelope.payload : null;
    const handshakeId = handshakePayload?.handshakeId;
    const sessionId = handshakeEnvelope?.sessionId;
    expect(typeof handshakeId).toBe("string");
    expect(typeof sessionId).toBe("string");
    return { sessionId: sessionId as string, handshakeId: handshakeId as string };
  };

  const getRequestsFromSpy = (postMessageSpy: ReturnType<typeof vi.spyOn>) => {
    const calls = postMessageSpy.mock.calls as Array<Parameters<Window["postMessage"]>>;
    return calls
      .map(([candidate]) => candidate)
      .filter((msg) => isRecord(msg) && msg.channel === CHANNEL && msg.type === "request")
      .map((requestEnvelope) => {
        if (!isRecord(requestEnvelope)) throw new Error("Expected request envelope to be an object");
        const sessionId = requestEnvelope.sessionId;
        const id = requestEnvelope.id;
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
    payload: Record<string, unknown>,
    options?: { protocolVersion?: number | null },
  ) => {
    const protocolVersion = options?.protocolVersion ?? PROTOCOL_VERSION;
    dispatchEnvelope({
      channel: CHANNEL,
      sessionId,
      type: "handshake_ack",
      payload: {
        ...(protocolVersion === null ? {} : { protocolVersion }),
        handshakeId,
        state: payload,
      },
    });
  };

  const bootstrapWithHandshakeAck = async (
    transport: WindowPostMessageTransport,
    options?: { accounts?: string[]; postMessageSpy?: ReturnType<typeof vi.spyOn> },
  ) => {
    const postMessageSpy = options?.postMessageSpy ?? vi.spyOn(window, "postMessage");
    const shouldRestore = !options?.postMessageSpy;
    const pendingBootstrap = transport.bootstrap();
    const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);
    dispatchHandshakeAck(sessionId, handshakeId, {
      chainId: "0x1",
      chainRef: "eip155:1",
      accounts: options?.accounts ?? [],
      isUnlocked: true,
      meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
    });
    const snapshot = await pendingBootstrap;
    if (shouldRestore) {
      postMessageSpy.mockRestore();
    }
    return { sessionId, snapshot };
  };

  describe("bootstrap", () => {
    it("returns an explicit bootstrap snapshot and marks the transport connected", async () => {
      const transport = createTransport();
      const { snapshot } = await bootstrapWithHandshakeAck(transport, { accounts: ["0xabc"] });

      expect(snapshot).toEqual({
        connected: true,
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
      });
      expect(transport.isConnected()).toBe(true);
    });

    it("reuses the resolved bootstrap snapshot while still connected", async () => {
      const transport = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");
      const first = transport.bootstrap();
      const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

      dispatchHandshakeAck(sessionId, handshakeId, {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xabc"],
        isUnlocked: true,
        meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
      });

      await expect(first).resolves.toMatchObject({ accounts: ["0xabc"] });
      postMessageSpy.mockClear();

      await expect(transport.bootstrap()).resolves.toMatchObject({ accounts: ["0xabc"] });
      expect(postMessageSpy).not.toHaveBeenCalled();

      postMessageSpy.mockRestore();
    });

    it("accepts handshake_ack without protocolVersion (defaults to v1)", async () => {
      const transport = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");

      const pendingBootstrap = transport.bootstrap();
      const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

      dispatchHandshakeAck(
        sessionId,
        handshakeId,
        {
          chainId: "0x1",
          chainRef: "eip155:1",
          accounts: ["0xabc"],
          isUnlocked: true,
          meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
        },
        { protocolVersion: null },
      );

      await expect(pendingBootstrap).resolves.toMatchObject({ chainId: "0x1" });
      expect(transport.isConnected()).toBe(true);
      postMessageSpy.mockRestore();
    });

    it("rejects bootstrap when handshake_ack has unsupported protocolVersion", async () => {
      const transport = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");

      const pendingBootstrap = transport.bootstrap();
      const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

      dispatchHandshakeAck(
        sessionId,
        handshakeId,
        {
          chainId: "0x1",
          chainRef: "eip155:1",
          accounts: ["0xabc"],
          isUnlocked: true,
          meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
        },
        { protocolVersion: 999 },
      );

      await expect(pendingBootstrap).rejects.toMatchObject({
        kind: "transport_failure",
        reason: "protocol_version_mismatch",
      });
      expect(transport.isConnected()).toBe(false);
      postMessageSpy.mockRestore();
    });

    it("ignores malformed handshake_ack payload without crashing", async () => {
      vi.useFakeTimers();
      try {
        const transport = new WindowPostMessageTransport({
          namespace: "eip155",
          codec: eip155TransportCodec,
          handshakeTimeoutMs: 20,
        });
        instances.push(transport);

        const postMessageSpy = vi.spyOn(window, "postMessage");
        const pendingBootstrap = transport.bootstrap().catch((err) => err);
        const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

        dispatchEnvelope({
          channel: CHANNEL,
          sessionId,
          type: "handshake_ack",
          payload: { protocolVersion: PROTOCOL_VERSION, handshakeId, state: { chainId: "0x1" } },
        });

        await vi.advanceTimersByTimeAsync(25);
        await expect(pendingBootstrap).resolves.toMatchObject({
          kind: "transport_failure",
          reason: "handshake_timeout",
        });
        postMessageSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("requests", () => {
    it("requires bootstrap before sending requests", async () => {
      const transport = createTransport();
      await expect(transport.request({ method: "eth_chainId" })).rejects.toMatchObject({
        kind: "transport_failure",
        reason: "disconnected",
      });
    });

    it("correlates requests by session id and request id after bootstrap", async () => {
      const transport = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");
      const { sessionId } = await bootstrapWithHandshakeAck(transport, { postMessageSpy });

      const pendingRequest = transport.request({ method: "eth_chainId" });
      const [{ id, sessionId: requestSessionId }] = getRequestsFromSpy(postMessageSpy);

      expect(requestSessionId).toBe(sessionId);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "response",
        id,
        payload: { jsonrpc: "2.0", id, result: "0x1" },
      });

      await expect(pendingRequest).resolves.toBe("0x1");
      postMessageSpy.mockRestore();
    });

    it("rejects pending requests when disconnect arrives", async () => {
      const transport = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");
      const { sessionId } = await bootstrapWithHandshakeAck(transport, { postMessageSpy });

      const pendingRequest = transport.request({ method: "eth_chainId" });
      const [{ id }] = getRequestsFromSpy(postMessageSpy);
      expect(typeof id).toBe("string");

      const disconnectListener = vi.fn();
      transport.on("disconnect", disconnectListener);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.disconnect, params: [] },
      });

      await expect(pendingRequest).rejects.toMatchObject({ code: 4900 });
      expect(disconnectListener).toHaveBeenCalledTimes(1);
      expect(transport.isConnected()).toBe(false);
      postMessageSpy.mockRestore();
    });
  });

  describe("patch stream", () => {
    it("replays bootstrap-time patches onto the first visible snapshot", async () => {
      const transport = createTransport();
      const postMessageSpy = vi.spyOn(window, "postMessage");

      const pendingBootstrap = transport.bootstrap();
      const { sessionId, handshakeId } = getHandshakeFromSpy(postMessageSpy);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.accountsChanged, params: [["0xbbb"]] },
      });

      dispatchHandshakeAck(sessionId, handshakeId, {
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xaaa"],
        isUnlocked: true,
        meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
      });

      await expect(pendingBootstrap).resolves.toEqual({
        connected: true,
        chainId: "0x1",
        chainRef: "eip155:1",
        accounts: ["0xbbb"],
        isUnlocked: true,
        meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
      });
      postMessageSpy.mockRestore();
    });

    it("normalizes accountsChanged into a provider patch", async () => {
      const transport = createTransport();
      const { sessionId } = await bootstrapWithHandshakeAck(transport, { accounts: ["0xaaa"] });
      const patchListener = vi.fn();
      transport.on("patch", patchListener);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.accountsChanged, params: [["0xbbb"]] },
      });

      expect(patchListener).toHaveBeenCalledTimes(1);
      expect(patchListener).toHaveBeenCalledWith({ type: "accounts", accounts: ["0xbbb"] });
    });

    it("normalizes chainChanged into a chain patch", async () => {
      const transport = createTransport();
      const { sessionId } = await bootstrapWithHandshakeAck(transport);
      const patchListener = vi.fn();
      transport.on("patch", patchListener);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: {
          event: PROVIDER_EVENTS.chainChanged,
          params: [
            {
              chainId: "0x89",
              chainRef: "eip155:137",
              isUnlocked: false,
              meta: { activeChainByNamespace: { eip155: "eip155:137" }, supportedChains: ["eip155:1", "eip155:137"] },
            },
          ],
        },
      });

      expect(patchListener).toHaveBeenCalledTimes(1);
      expect(patchListener).toHaveBeenCalledWith({
        type: "chain",
        chainId: "0x89",
        chainRef: "eip155:137",
        isUnlocked: false,
        meta: { activeChainByNamespace: { eip155: "eip155:137" }, supportedChains: ["eip155:1", "eip155:137"] },
      });
    });

    it("converts session lock events into canonical patches instead of local state APIs", async () => {
      const transport = createTransport();
      const { sessionId } = await bootstrapWithHandshakeAck(transport, { accounts: ["0xaaa"] });
      const patchListener = vi.fn();
      transport.on("patch", patchListener);

      dispatchEnvelope({
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.sessionLocked, params: [{}] },
      });

      expect(patchListener).toHaveBeenCalledTimes(2);
      expect(patchListener.mock.calls[0]?.[0]).toEqual({ type: "accounts", accounts: [] });
      expect(patchListener.mock.calls[1]?.[0]).toEqual({ type: "unlock", isUnlocked: false });
    });
  });
});
