import type { WalletProvider } from "@arx/core/engine";
import type { ProviderRuntimeRpcResponse } from "@arx/core/runtime";
import { CHANNEL } from "@arx/provider/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { createProviderPortServer } from "./providerPortServer";
import type { ProviderBridgeConnectionState, ProviderBridgeSnapshot } from "./types";

vi.mock("./origin", () => ({
  getPortOrigin: vi.fn(),
}));

type Listener = (message: unknown) => void;
type ProviderLifecyclePayload = { reason?: string };
type ProviderConnectionStateChange = Parameters<WalletProvider["subscribeConnectionStateChanged"]>[0] extends (
  change: infer T,
) => void
  ? T
  : never;

class FakePort {
  name = CHANNEL;
  sender: unknown = {};
  postMessage = vi.fn();
  disconnect = vi.fn();

  #messageListeners = new Set<Listener>();
  #disconnectListeners = new Set<() => void>();

  onMessage = {
    addListener: (fn: Listener) => this.#messageListeners.add(fn),
    removeListener: (fn: Listener) => this.#messageListeners.delete(fn),
  };

  onDisconnect = {
    addListener: (fn: () => void) => this.#disconnectListeners.add(fn),
    removeListener: (fn: () => void) => this.#disconnectListeners.delete(fn),
  };

  triggerMessage(message: unknown) {
    for (const listener of this.#messageListeners) {
      listener(message);
    }
  }

  triggerDisconnect() {
    for (const listener of this.#disconnectListeners) {
      listener();
    }
  }
}

const makeSnapshot = (
  namespace: string,
  isUnlocked: boolean,
  overrides?: Partial<ProviderBridgeSnapshot>,
): ProviderBridgeSnapshot => ({
  namespace,
  chain: {
    chainId: namespace === "conflux" ? "0x405" : "0x1",
    chainRef: namespace === "conflux" ? "conflux:1029" : `${namespace}:1`,
    ...(overrides?.chain ?? {}),
  },
  isUnlocked,
});

const makeConnectionState = (
  snapshot: ProviderBridgeSnapshot,
  accounts: readonly string[],
): ProviderBridgeConnectionState => ({
  snapshot,
  accounts: [...accounts],
});

const handshake = (port: FakePort, sessionId: string, namespace: string) => {
  port.triggerMessage({
    channel: CHANNEL,
    sessionId,
    type: "handshake",
    payload: { handshakeId: `h-${sessionId}`, namespace },
  });
};

const buildTestConnectionScopeKey = ({ origin, namespace }: { origin: string; namespace: string }) =>
  `${origin}\n${namespace}`;

const createServerHarness = (options?: {
  resolveAccounts?: (input: { origin: string; namespace: string; chainRef: string }) => string[];
  activateConnectionScope?: WalletProvider["activateConnectionScope"];
  request?: WalletProvider["request"];
  encodeRuntimeRpcError?: WalletProvider["encodeRuntimeRpcError"];
  cancelRequestScope?: WalletProvider["cancelRequestScope"];
  snapshots?: Record<string, ProviderBridgeSnapshot>;
  failFirstProviderBootstrap?: boolean;
}) => {
  const sessionUnlockedHandlers = new Set<(payload: ProviderLifecyclePayload) => void>();
  const sessionLockedHandlers = new Set<(payload: ProviderLifecyclePayload) => void>();
  const connectionStateChangedHandlers = new Set<(change: ProviderConnectionStateChange) => void>();

  const snapshots = new Map<string, ProviderBridgeSnapshot>();
  const seedSnapshots = options?.snapshots ?? {
    eip155: makeSnapshot("eip155", true),
    conflux: makeSnapshot("conflux", true),
  };
  for (const [namespace, snapshot] of Object.entries(seedSnapshots)) {
    snapshots.set(namespace, snapshot);
  }
  const activeConnectionScopes = new Set<string>();
  let shouldFailFirstProviderBootstrap = options?.failFirstProviderBootstrap ?? false;

  const resolveAccounts =
    options?.resolveAccounts ??
    (({ chainRef }: { origin: string; namespace: string; chainRef: string }) =>
      chainRef === "conflux:1029" ? ["cfx:aatest"] : ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"]);

  const buildConnectionState = (input: { origin: string; namespace: string }) => {
    const snapshot = snapshots.get(buildTestConnectionScopeKey(input)) ?? snapshots.get(input.namespace);
    if (!snapshot) {
      throw new Error(`Missing snapshot for ${input.namespace}`);
    }

    const accounts = snapshot.isUnlocked
      ? resolveAccounts({
          origin: input.origin,
          namespace: input.namespace,
          chainRef: snapshot.chain.chainRef,
        })
      : [];

    return {
      snapshot,
      accounts,
      connected: activeConnectionScopes.has(buildTestConnectionScopeKey(input)) && accounts.length > 0,
    };
  };
  const buildProviderConnectionState = (input: {
    origin: string;
    namespace: string;
  }): ProviderBridgeConnectionState => {
    const state = buildConnectionState(input);
    return {
      snapshot: state.snapshot,
      accounts: state.accounts,
    };
  };

  const getConnectionState = vi.fn(async (input: { origin: string; namespace: string }) => buildConnectionState(input));
  const activateConnectionScope = vi.fn(
    options?.activateConnectionScope ??
      (async (input: { origin: string; namespace: string }) => {
        activeConnectionScopes.add(buildTestConnectionScopeKey(input));
        return buildProviderConnectionState(input);
      }),
  );
  const deactivateConnectionScope = vi.fn((input: { origin: string; namespace: string }) => {
    activeConnectionScopes.delete(buildTestConnectionScopeKey(input));
  });
  const request = vi.fn(
    options?.request ??
      (async (input) =>
        ({
          id: input.request.id,
          jsonrpc: input.request.jsonrpc,
          result: null,
        }) satisfies ProviderRuntimeRpcResponse),
  );
  const encodeRuntimeRpcError = vi.fn(
    options?.encodeRuntimeRpcError ??
      ((error: unknown) => {
        const payload = error as { code?: number; message?: string } | undefined;
        return {
          kind: "JsonRpcError" as const,
          code: payload?.code ?? -32603,
          message: payload?.message ?? "Internal error",
        };
      }),
  );
  const cancelRequestScope = vi.fn(options?.cancelRequestScope ?? (async () => 1));

  const provider: WalletProvider = {
    getConnectionState,
    activateConnectionScope,
    deactivateConnectionScope,
    subscribeConnectionStateChanged: (listener) => {
      connectionStateChangedHandlers.add(listener);
      return () => connectionStateChangedHandlers.delete(listener);
    },
    request,
    encodeRuntimeRpcError,
    cancelRequestScope,
    subscribeSessionUnlocked: (listener) => {
      sessionUnlockedHandlers.add(listener as (payload: ProviderLifecyclePayload) => void);
      return () => sessionUnlockedHandlers.delete(listener as (payload: ProviderLifecyclePayload) => void);
    },
    subscribeSessionLocked: (listener) => {
      sessionLockedHandlers.add(listener as (payload: ProviderLifecyclePayload) => void);
      return () => sessionLockedHandlers.delete(listener as (payload: ProviderLifecyclePayload) => void);
    },
  };

  const getOrInitProvider = vi.fn(async () => {
    if (shouldFailFirstProviderBootstrap) {
      shouldFailFirstProviderBootstrap = false;
      throw new Error("provider bootstrap failed");
    }

    return provider;
  });

  const server = createProviderPortServer({
    extensionOrigin: "ext://",
    getOrInitProvider,
  });

  return {
    server,
    getOrInitProvider,
    mocks: {
      getConnectionState,
      activateConnectionScope,
      deactivateConnectionScope,
      request,
      encodeRuntimeRpcError,
      cancelRequestScope,
    },
    setSnapshot(namespaceOrScope: string | { origin: string; namespace: string }, snapshot: ProviderBridgeSnapshot) {
      const key =
        typeof namespaceOrScope === "string" ? namespaceOrScope : buildTestConnectionScopeKey(namespaceOrScope);
      snapshots.set(key, snapshot);
    },
    getSubscriptionCount(topic: "connectionState" | "sessionLocked") {
      if (topic === "connectionState") {
        return connectionStateChangedHandlers.size;
      }
      return sessionLockedHandlers.size;
    },
    emitSessionUnlocked(payload: ProviderLifecyclePayload) {
      for (const listener of sessionUnlockedHandlers) {
        listener(payload);
      }
    },
    emitSessionLocked(payload: ProviderLifecyclePayload) {
      for (const listener of sessionLockedHandlers) {
        listener(payload);
      }
    },
    emitConnectionStateChanged(change: ProviderConnectionStateChange) {
      for (const listener of connectionStateChangedHandlers) {
        listener(change);
      }
    },
    buildConnectionState,
    buildProviderConnectionState,
  };
};

describe("providerPortServer", () => {
  beforeEach(() => {
    vi.mocked(getPortOrigin).mockReturnValue("https://example.com");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends handshake_ack with empty accounts when locked and activates the provider connection scope", async () => {
    const lockedSnapshot = makeSnapshot("eip155", false);
    const harness = createServerHarness({
      snapshots: { eip155: lockedSnapshot },
    });

    harness.server.start();
    const port = new FakePort();
    harness.server.handleConnect(port as unknown as Runtime.Port);

    handshake(port, "session-1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(harness.mocks.activateConnectionScope).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        type: "handshake_ack",
        payload: expect.objectContaining({
          handshakeId: "h-session-1",
          state: {
            accounts: [],
            chainId: "0x1",
            chainRef: "eip155:1",
            isUnlocked: false,
          },
        }),
      }),
    );
  });

  it("keeps one live connection scope for multiple sessions on the same origin and namespace", async () => {
    const harness = createServerHarness();
    const firstPort = new FakePort();
    const secondPort = new FakePort();

    harness.server.handleConnect(firstPort as unknown as Runtime.Port);
    harness.server.handleConnect(secondPort as unknown as Runtime.Port);

    handshake(firstPort, "session-1", "eip155");
    await vi.waitFor(() => expect(firstPort.postMessage).toHaveBeenCalledTimes(1));

    handshake(secondPort, "session-2", "eip155");
    await vi.waitFor(() => expect(secondPort.postMessage).toHaveBeenCalledTimes(1));

    expect(harness.mocks.activateConnectionScope).toHaveBeenCalledTimes(1);
    expect(harness.mocks.getConnectionState).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });

    firstPort.triggerDisconnect();
    expect(harness.mocks.deactivateConnectionScope).not.toHaveBeenCalled();

    secondPort.triggerDisconnect();
    expect(harness.mocks.deactivateConnectionScope).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
  });

  it("does not revive a provider session when the port disconnects during connection activation", async () => {
    let resolveActivation: (value: ProviderBridgeConnectionState) => void = () => {
      throw new Error("activateConnectionScope resolver not initialized");
    };
    const activated = new Promise<ProviderBridgeConnectionState>((resolve) => {
      resolveActivation = resolve;
    });
    const harness = createServerHarness({
      activateConnectionScope: vi.fn(() => activated),
    });
    const port = new FakePort();

    harness.server.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");

    await vi.waitFor(() =>
      expect(harness.mocks.activateConnectionScope).toHaveBeenCalledWith({
        origin: "https://example.com",
        namespace: "eip155",
      }),
    );

    port.triggerDisconnect();
    expect(harness.mocks.deactivateConnectionScope).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });

    resolveActivation(makeConnectionState(makeSnapshot("eip155", true), ["0xaaa"]));

    await vi.waitFor(() => expect(harness.mocks.deactivateConnectionScope).toHaveBeenCalledTimes(2));
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(harness.mocks.deactivateConnectionScope).toHaveBeenLastCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
  });

  it("rejects pending requests on same-scope session rotation without disconnect or reconnect churn", async () => {
    let resolveRequest: (value: ProviderRuntimeRpcResponse) => void = () => {
      throw new Error("request resolver not initialized");
    };
    const harness = createServerHarness({
      request: () =>
        new Promise<ProviderRuntimeRpcResponse>((resolve) => {
          resolveRequest = resolve;
        }),
      encodeRuntimeRpcError: () => ({ kind: "ArxError", code: "global.transport.disconnected" }),
    });
    const port = new FakePort();

    harness.server.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "session-1",
      type: "request",
      id: "transport-1",
      payload: {
        method: "eth_chainId",
      },
    });

    await vi.waitFor(() => expect(harness.mocks.request).toHaveBeenCalledTimes(1));

    handshake(port, "session-2", "eip155");

    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          type: "response",
          payload: {
            error: { kind: "ArxError", code: "global.transport.disconnected" },
          },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: "session-2",
          type: "handshake_ack",
        }),
      ),
    );

    expect(harness.mocks.activateConnectionScope).toHaveBeenCalledTimes(1);
    expect(harness.mocks.deactivateConnectionScope).not.toHaveBeenCalled();

    const postMessageCallCount = port.postMessage.mock.calls.length;
    resolveRequest({
      id: "transport-1",
      jsonrpc: "2.0",
      result: "0x1",
    });
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledTimes(postMessageCallCount);
  });

  it("forwards provider requests with the session rpc context", async () => {
    const harness = createServerHarness();
    const port = new FakePort();

    harness.server.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "session-1",
      type: "request",
      id: "transport-1",
      payload: {
        method: "wallet_requestPermissions",
      },
    });

    await vi.waitFor(() => expect(harness.mocks.request).toHaveBeenCalledTimes(1));
    const input = harness.mocks.request.mock.calls[0]?.[0] as Parameters<WalletProvider["request"]>[0];

    expect(input.request).toMatchObject({
      id: "transport-1",
      jsonrpc: "2.0",
      method: "wallet_requestPermissions",
    });
    expect(input.namespace).toBe("eip155");
    expect(input.scope).toMatchObject({
      transport: "provider",
      sessionId: "session-1",
      portId: expect.any(String),
      origin: "https://example.com",
    });
    expect(input.request).not.toHaveProperty("chainRef");
  });

  it("finalizes disconnect state and cancels provider-scoped approvals when a port disconnects", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");

    let resolveRequest: (value: ProviderRuntimeRpcResponse) => void = () => {
      throw new Error("request resolver not initialized");
    };
    const harness = createServerHarness({
      request: () =>
        new Promise<ProviderRuntimeRpcResponse>((resolve) => {
          resolveRequest = resolve;
        }),
      encodeRuntimeRpcError: () => ({ kind: "ArxError", code: "global.transport.disconnected" }),
    });
    const port = new FakePort();

    harness.server.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "session-1",
      type: "request",
      id: "transport-1",
      payload: {
        method: "eth_chainId",
      },
    });
    await vi.waitFor(() => expect(harness.mocks.request).toHaveBeenCalledTimes(1));

    port.triggerDisconnect();

    await vi.waitFor(() =>
      expect(harness.mocks.cancelRequestScope).toHaveBeenCalledWith({
        transport: "provider",
        origin: "https://example.com",
        portId: "11111111-1111-4111-8111-111111111111",
        sessionId: "session-1",
      }),
    );
    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          type: "response",
          payload: {
            error: { kind: "ArxError", code: "global.transport.disconnected" },
          },
        }),
      ),
    );
    expect(harness.mocks.deactivateConnectionScope).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });

    const postMessageCallCount = port.postMessage.mock.calls.length;
    resolveRequest({
      id: "transport-1",
      jsonrpc: "2.0",
      result: "0x1",
    });
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledTimes(postMessageCallCount);
  });

  it("projects namespace-scoped chain and account updates from the core change payload", async () => {
    const harness = createServerHarness({
      snapshots: {
        eip155: makeSnapshot("eip155", true),
        conflux: makeSnapshot("conflux", true, {
          chain: { chainId: "0x405", chainRef: "conflux:1029" },
        }),
      },
    });
    const evmPort = new FakePort();
    const confluxPort = new FakePort();

    harness.server.start();
    await vi.waitFor(() => expect(harness.getSubscriptionCount("connectionState")).toBe(1));

    harness.server.handleConnect(evmPort as unknown as Runtime.Port);
    harness.server.handleConnect(confluxPort as unknown as Runtime.Port);
    handshake(evmPort, "session-evm", "eip155");
    handshake(confluxPort, "session-cfx", "conflux");
    await vi.waitFor(() => expect(evmPort.postMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(confluxPort.postMessage).toHaveBeenCalledTimes(1));

    evmPort.postMessage.mockClear();
    confluxPort.postMessage.mockClear();
    harness.mocks.getConnectionState.mockClear();

    const scope = { origin: "https://example.com", namespace: "conflux" };
    const previous = makeConnectionState(
      makeSnapshot("conflux", true, {
        chain: { chainId: "0x405", chainRef: "conflux:1029" },
      }),
      ["cfx:old"],
    );
    const nextSnapshot = makeSnapshot("conflux", true, {
      chain: { chainId: "0x406", chainRef: "conflux:1030" },
    });
    const next = makeConnectionState(nextSnapshot, ["cfx:new"]);
    harness.setSnapshot(
      "conflux",
      makeSnapshot("conflux", true, {
        chain: { chainId: "0x405", chainRef: "conflux:1029" },
      }),
    );

    harness.emitConnectionStateChanged({
      scope,
      previous,
      next,
      changed: { chain: true, accounts: true },
    });

    await vi.waitFor(() =>
      expect(confluxPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "event",
          payload: {
            event: "chainChanged",
            params: [
              expect.objectContaining({
                chainId: "0x406",
                chainRef: "conflux:1030",
              }),
            ],
          },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(confluxPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "event",
          payload: { event: "accountsChanged", params: [["cfx:new"]] },
        }),
      ),
    );
    expect(evmPort.postMessage).not.toHaveBeenCalled();
    expect(harness.mocks.getConnectionState).not.toHaveBeenCalled();
  });

  it("projects provider-chain changes only to ports connected to the changed origin and namespace", async () => {
    const firstOrigin = "https://first.example";
    const secondOrigin = "https://second.example";
    const harness = createServerHarness({
      resolveAccounts: ({ origin, chainRef }) => {
        if (origin === firstOrigin && chainRef === "eip155:10") {
          return ["0xfirstAlt"];
        }
        if (origin === firstOrigin) {
          return ["0xfirstMain"];
        }
        return ["0xsecondMain"];
      },
      snapshots: {
        eip155: makeSnapshot("eip155", true),
      },
    });
    const firstPort = new FakePort();
    const secondPort = new FakePort();

    vi.mocked(getPortOrigin).mockImplementation((port) => {
      if (port === (firstPort as unknown as Runtime.Port)) return firstOrigin;
      if (port === (secondPort as unknown as Runtime.Port)) return secondOrigin;
      return "https://example.com";
    });

    harness.server.start();
    await vi.waitFor(() => expect(harness.getSubscriptionCount("connectionState")).toBe(1));

    harness.server.handleConnect(firstPort as unknown as Runtime.Port);
    harness.server.handleConnect(secondPort as unknown as Runtime.Port);
    handshake(firstPort, "session-first", "eip155");
    handshake(secondPort, "session-second", "eip155");
    await vi.waitFor(() => expect(firstPort.postMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(secondPort.postMessage).toHaveBeenCalledTimes(1));

    firstPort.postMessage.mockClear();
    secondPort.postMessage.mockClear();
    harness.mocks.getConnectionState.mockClear();

    const scope = { origin: firstOrigin, namespace: "eip155" };
    const previous = makeConnectionState(makeSnapshot("eip155", true), ["0xfirstMain"]);
    const nextSnapshot = makeSnapshot("eip155", true, {
      chain: { chainId: "0xa", chainRef: "eip155:10" },
    });
    const next = makeConnectionState(nextSnapshot, ["0xfirstAlt"]);
    harness.setSnapshot(scope, makeSnapshot("eip155", true));

    harness.emitConnectionStateChanged({
      scope,
      previous,
      next,
      changed: { chain: true, accounts: true },
    });

    await vi.waitFor(() =>
      expect(firstPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "event",
          payload: {
            event: "chainChanged",
            params: [
              expect.objectContaining({
                chainId: "0xa",
                chainRef: "eip155:10",
              }),
            ],
          },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(firstPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "event",
          payload: { event: "accountsChanged", params: [["0xfirstAlt"]] },
        }),
      ),
    );
    expect(secondPort.postMessage).not.toHaveBeenCalled();
    expect(harness.mocks.getConnectionState).not.toHaveBeenCalled();
  });

  it("keeps the provider session alive while projecting lock state", async () => {
    const harness = createServerHarness({
      snapshots: {
        eip155: makeSnapshot("eip155", true),
      },
    });
    const port = new FakePort();

    harness.server.start();
    await vi.waitFor(() => expect(harness.getSubscriptionCount("sessionLocked")).toBe(1));

    harness.server.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.postMessage.mockClear();
    const scope = { origin: "https://example.com", namespace: "eip155" };
    const previous = harness.buildProviderConnectionState(scope);
    harness.setSnapshot("eip155", makeSnapshot("eip155", false));
    const next = harness.buildProviderConnectionState(scope);
    harness.emitSessionLocked({ reason: "manual" });
    harness.emitConnectionStateChanged({
      scope,
      previous,
      next,
      changed: { chain: false, accounts: true },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    expect(port.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "event",
        payload: { event: "session:locked", params: [{ reason: "manual" }] },
      }),
    );
    expect(port.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "event",
        payload: { event: "accountsChanged", params: [[]] },
      }),
    );
    expect(harness.mocks.deactivateConnectionScope).not.toHaveBeenCalled();
    expect(port.disconnect).not.toHaveBeenCalled();

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "session-1",
      type: "request",
      id: "transport-after-lock",
      payload: {
        method: "eth_chainId",
      },
    });

    await vi.waitFor(() => expect(harness.mocks.request).toHaveBeenCalledTimes(1));
  });
});
