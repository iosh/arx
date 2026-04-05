import type { WalletProvider } from "@arx/core/engine";
import type { JsonRpcResponse } from "@arx/core/rpc";
import type { NetworkPreferencesRecord } from "@arx/core/storage";
import { CHANNEL } from "@arx/provider/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { createProviderPortServer } from "./providerPortServer";
import type { ProviderBridgeSnapshot } from "./types";

vi.mock("./origin", () => ({
  getPortOrigin: vi.fn(),
}));

type Listener = (message: unknown) => void;
type ProviderLifecyclePayload = { reason?: string };

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
  meta: {
    activeChainByNamespace: {
      [namespace]: namespace === "conflux" ? "conflux:1029" : `${namespace}:1`,
    },
    supportedChains: [namespace === "conflux" ? "conflux:1029" : `${namespace}:1`],
    ...(overrides?.meta ?? {}),
  },
});

const makeNetworkPreferencesRecord = (overrides?: Partial<NetworkPreferencesRecord>): NetworkPreferencesRecord => ({
  id: "network-preferences",
  selectedNamespace: "eip155",
  activeChainByNamespace: {
    eip155: "eip155:1",
  },
  rpc: {},
  updatedAt: 0,
  ...(overrides ?? {}),
});

const buildBindingKey = (input: { origin: string; namespace: string }) =>
  JSON.stringify([input.origin, input.namespace]);

const handshake = (port: FakePort, sessionId: string, namespace: string) => {
  port.triggerMessage({
    channel: CHANNEL,
    sessionId,
    type: "handshake",
    payload: { handshakeId: `h-${sessionId}`, namespace },
  });
};

const createServerHarness = (options?: {
  resolveAccounts?: (input: { origin: string; namespace: string; chainRef: string }) => string[];
  executeRpcRequest?: WalletProvider["executeRpcRequest"];
  encodeRpcError?: WalletProvider["encodeRpcError"];
  cancelSessionApprovals?: WalletProvider["cancelSessionApprovals"];
  snapshots?: Record<string, ProviderBridgeSnapshot>;
  failFirstProviderBootstrap?: boolean;
}) => {
  const sessionUnlockedHandlers = new Set<(payload: ProviderLifecyclePayload) => void>();
  const sessionLockedHandlers = new Set<(payload: ProviderLifecyclePayload) => void>();
  const networkStateHandlers = new Set<() => void>();
  const networkPreferenceHandlers = new Set<() => void>();
  const accountsStateHandlers = new Set<() => void>();
  const permissionsStateHandlers = new Set<() => void>();

  const snapshots = options?.snapshots ?? {
    eip155: makeSnapshot("eip155", true),
    conflux: makeSnapshot("conflux", true),
  };
  const activeBindings = new Set<string>();
  let shouldFailFirstProviderBootstrap = options?.failFirstProviderBootstrap ?? false;

  const resolveAccounts =
    options?.resolveAccounts ??
    (({ chainRef }: { origin: string; namespace: string; chainRef: string }) =>
      chainRef === "conflux:1029" ? ["cfx:aatest"] : ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"]);

  const buildProjection = (input: { origin: string; namespace: string }) => {
    const snapshot = snapshots[input.namespace];
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
      connected: activeBindings.has(buildBindingKey(input)) && accounts.length > 0,
    };
  };

  const buildSnapshot = vi.fn((namespace: string) => {
    const snapshot = snapshots[namespace];
    if (!snapshot) {
      throw new Error(`Missing snapshot for ${namespace}`);
    }
    return snapshot;
  });
  const buildConnectionProjection = vi.fn((input: { origin: string; namespace: string }) => buildProjection(input));
  const connect = vi.fn((input: { origin: string; namespace: string }) => {
    const projection = buildProjection(input);
    if (projection.accounts.length > 0) {
      activeBindings.add(buildBindingKey(input));
    }
    return buildProjection(input);
  });
  const disconnect = vi.fn((input: { origin: string; namespace: string }) => {
    activeBindings.delete(buildBindingKey(input));
    return buildProjection(input);
  });
  const disconnectOrigin = vi.fn((origin: string) => {
    const keys = [...activeBindings].filter((key) => JSON.parse(key)[0] === origin);
    for (const key of keys) {
      activeBindings.delete(key);
    }
    return keys.length;
  });
  const executeRpcRequest = vi.fn(
    options?.executeRpcRequest ??
      (async (request) =>
        ({
          id: request.id,
          jsonrpc: request.jsonrpc,
          result: null,
        }) satisfies JsonRpcResponse),
  );
  const encodeRpcError = vi.fn(
    options?.encodeRpcError ??
      ((error: unknown) => {
        const payload = error as { code?: number; message?: string } | undefined;
        return {
          code: payload?.code ?? 4900,
          message: payload?.message ?? "Disconnected",
        };
      }),
  );
  const cancelSessionApprovals = vi.fn(options?.cancelSessionApprovals ?? (async () => 1));

  const provider: WalletProvider = {
    buildSnapshot,
    buildConnectionProjection,
    executeRpcRequest,
    encodeRpcError,
    connect,
    disconnect,
    disconnectOrigin,
    cancelSessionApprovals,
    subscribeSessionUnlocked: (listener) => {
      sessionUnlockedHandlers.add(listener as (payload: ProviderLifecyclePayload) => void);
      return () => sessionUnlockedHandlers.delete(listener as (payload: ProviderLifecyclePayload) => void);
    },
    subscribeSessionLocked: (listener) => {
      sessionLockedHandlers.add(listener as (payload: ProviderLifecyclePayload) => void);
      return () => sessionLockedHandlers.delete(listener as (payload: ProviderLifecyclePayload) => void);
    },
    subscribeNetworkStateChanged: (listener) => {
      networkStateHandlers.add(listener);
      return () => networkStateHandlers.delete(listener);
    },
    subscribeNetworkPreferencesChanged: (listener) => {
      const nextListener = () =>
        listener({
          next: makeNetworkPreferencesRecord(),
        });
      networkPreferenceHandlers.add(nextListener);
      return () => networkPreferenceHandlers.delete(nextListener);
    },
    subscribeAccountsStateChanged: (listener) => {
      accountsStateHandlers.add(listener);
      return () => accountsStateHandlers.delete(listener);
    },
    subscribePermissionsStateChanged: (listener) => {
      permissionsStateHandlers.add(listener);
      return () => permissionsStateHandlers.delete(listener);
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
      buildSnapshot,
      buildConnectionProjection,
      connect,
      disconnect,
      disconnectOrigin,
      executeRpcRequest,
      encodeRpcError,
      cancelSessionApprovals,
    },
    setSnapshot(namespace: string, snapshot: ProviderBridgeSnapshot) {
      snapshots[namespace] = snapshot;
    },
    getSubscriptionCount(topic: "network" | "sessionLocked") {
      if (topic === "network") {
        return networkStateHandlers.size;
      }
      return sessionLockedHandlers.size;
    },
    emitNetworkStateChanged() {
      for (const listener of networkStateHandlers) {
        listener();
      }
    },
    emitNetworkPreferencesChanged() {
      for (const listener of networkPreferenceHandlers) {
        listener();
      }
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
    emitAccountsStateChanged() {
      for (const listener of accountsStateHandlers) {
        listener();
      }
    },
    emitPermissionsStateChanged() {
      for (const listener of permissionsStateHandlers) {
        listener();
      }
    },
  };
};

describe("providerPortServer", () => {
  beforeEach(() => {
    vi.mocked(getPortOrigin).mockReturnValue("https://example.com");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends handshake_ack with empty accounts when locked and drives the provider boundary", async () => {
    const lockedSnapshot = makeSnapshot("eip155", false);
    const harness = createServerHarness({
      snapshots: { eip155: lockedSnapshot },
    });

    harness.server.start();
    const port = new FakePort();
    harness.server.handleConnect(port as unknown as Runtime.Port);

    handshake(port, "session-1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(harness.mocks.connect).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        type: "handshake_ack",
        payload: expect.objectContaining({
          accounts: [],
          chainId: "0x1",
          chainRef: "eip155:1",
          handshakeId: "h-session-1",
          isUnlocked: false,
          meta: lockedSnapshot.meta,
        }),
      }),
    );
  });

  it("keeps one live binding for multiple sessions on the same origin and namespace", async () => {
    const harness = createServerHarness();
    const firstPort = new FakePort();
    const secondPort = new FakePort();

    harness.server.handleConnect(firstPort as unknown as Runtime.Port);
    harness.server.handleConnect(secondPort as unknown as Runtime.Port);

    handshake(firstPort, "session-1", "eip155");
    await vi.waitFor(() => expect(firstPort.postMessage).toHaveBeenCalledTimes(1));

    handshake(secondPort, "session-2", "eip155");
    await vi.waitFor(() => expect(secondPort.postMessage).toHaveBeenCalledTimes(1));

    expect(harness.mocks.connect).toHaveBeenCalledTimes(1);
    expect(harness.mocks.buildConnectionProjection).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });

    firstPort.triggerDisconnect();
    expect(harness.mocks.disconnect).not.toHaveBeenCalled();

    secondPort.triggerDisconnect();
    expect(harness.mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.mocks.disconnect).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
  });

  it("rejects pending requests on same-binding session rotation without disconnect or reconnect churn", async () => {
    let resolveRequest: (value: JsonRpcResponse) => void = () => {
      throw new Error("executeRpcRequest resolver not initialized");
    };
    const harness = createServerHarness({
      executeRpcRequest: () =>
        new Promise<JsonRpcResponse>((resolve) => {
          resolveRequest = resolve;
        }),
      encodeRpcError: () => ({ code: 4900, message: "Disconnected" }),
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
        id: "rpc-1",
        jsonrpc: "2.0",
        method: "eth_chainId",
      },
    });

    await vi.waitFor(() => expect(harness.mocks.executeRpcRequest).toHaveBeenCalledTimes(1));

    handshake(port, "session-2", "eip155");

    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          type: "response",
          payload: {
            id: "rpc-1",
            jsonrpc: "2.0",
            error: { code: 4900, message: "Disconnected" },
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

    expect(harness.mocks.connect).toHaveBeenCalledTimes(1);
    expect(harness.mocks.disconnect).not.toHaveBeenCalled();

    const postMessageCallCount = port.postMessage.mock.calls.length;
    resolveRequest({
      id: "rpc-1",
      jsonrpc: "2.0",
      result: "0x1",
    });
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledTimes(postMessageCallCount);
  });

  it("forwards provider-bound requests with the bound rpc context", async () => {
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
        id: "rpc-1",
        jsonrpc: "2.0",
        method: "wallet_requestPermissions",
      },
    });

    await vi.waitFor(() => expect(harness.mocks.executeRpcRequest).toHaveBeenCalledTimes(1));
    const request = harness.mocks.executeRpcRequest.mock.calls[0]?.[0] as {
      context?: {
        providerNamespace?: string;
        chainRef?: string;
        requestContext?: { transport?: string; sessionId?: string; requestId?: string };
      };
    };

    expect(request.context).toMatchObject({
      providerNamespace: "eip155",
      chainRef: "eip155:1",
      requestContext: {
        transport: "provider",
        requestId: "rpc-1",
        sessionId: "session-1",
      },
    });
  });

  it("finalizes disconnect state and cancels provider-scoped approvals when a port disconnects", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");

    let resolveRequest: (value: JsonRpcResponse) => void = () => {
      throw new Error("executeRpcRequest resolver not initialized");
    };
    const harness = createServerHarness({
      executeRpcRequest: () =>
        new Promise<JsonRpcResponse>((resolve) => {
          resolveRequest = resolve;
        }),
      encodeRpcError: () => ({ code: 4900, message: "Disconnected" }),
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
        id: "rpc-1",
        jsonrpc: "2.0",
        method: "eth_chainId",
      },
    });
    await vi.waitFor(() => expect(harness.mocks.executeRpcRequest).toHaveBeenCalledTimes(1));

    port.triggerDisconnect();

    await vi.waitFor(() =>
      expect(harness.mocks.cancelSessionApprovals).toHaveBeenCalledWith({
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
            id: "rpc-1",
            jsonrpc: "2.0",
            error: { code: 4900, message: "Disconnected" },
          },
        }),
      ),
    );
    expect(harness.mocks.disconnect).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });

    const postMessageCallCount = port.postMessage.mock.calls.length;
    resolveRequest({
      id: "rpc-1",
      jsonrpc: "2.0",
      result: "0x1",
    });
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledTimes(postMessageCallCount);
  });

  it("projects namespace-scoped chain and account updates from the latest snapshot", async () => {
    const harness = createServerHarness({
      resolveAccounts: ({ chainRef }) => {
        if (chainRef === "conflux:1030") {
          return ["cfx:new"];
        }
        if (chainRef === "conflux:1029") {
          return ["cfx:old"];
        }
        return ["0xaaa"];
      },
      snapshots: {
        eip155: makeSnapshot("eip155", true),
        conflux: makeSnapshot("conflux", true, {
          chain: { chainId: "0x405", chainRef: "conflux:1029" },
          meta: {
            activeChainByNamespace: { conflux: "conflux:1029" },
            supportedChains: ["conflux:1029", "conflux:1030"],
          },
        }),
      },
    });
    const evmPort = new FakePort();
    const confluxPort = new FakePort();

    harness.server.start();
    await vi.waitFor(() => expect(harness.getSubscriptionCount("network")).toBe(1));

    harness.server.handleConnect(evmPort as unknown as Runtime.Port);
    harness.server.handleConnect(confluxPort as unknown as Runtime.Port);
    handshake(evmPort, "session-evm", "eip155");
    handshake(confluxPort, "session-cfx", "conflux");
    await vi.waitFor(() => expect(evmPort.postMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(confluxPort.postMessage).toHaveBeenCalledTimes(1));

    harness.emitNetworkStateChanged();
    await vi.waitFor(() => expect(confluxPort.postMessage.mock.calls.length).toBeGreaterThan(1));

    evmPort.postMessage.mockClear();
    confluxPort.postMessage.mockClear();

    harness.setSnapshot(
      "conflux",
      makeSnapshot("conflux", true, {
        chain: { chainId: "0x406", chainRef: "conflux:1030" },
        meta: {
          activeChainByNamespace: { conflux: "conflux:1030" },
          supportedChains: ["conflux:1029", "conflux:1030"],
        },
      }),
    );

    harness.emitNetworkStateChanged();

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
  });

  it("serializes sessionLocked projection before disconnect finality", async () => {
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
    harness.setSnapshot("eip155", makeSnapshot("eip155", false));
    harness.emitSessionLocked({ reason: "manual" });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(3));
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
    expect(port.postMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: "event",
        payload: {
          event: "disconnect",
          params: [{ code: 4900, message: "Disconnected" }],
        },
      }),
    );
    expect(harness.mocks.disconnect).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
  });
});
