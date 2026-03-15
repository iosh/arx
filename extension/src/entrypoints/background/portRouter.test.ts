import type { JsonRpcResponse } from "@arx/core/rpc";
import type { ProviderRuntimeSurface } from "@arx/core/runtime";
import { CHANNEL } from "@arx/provider/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { createPortRouter } from "./portRouter";
import type { ProviderBridgeSnapshot } from "./types";

vi.mock("./origin", () => ({
  getPortOrigin: vi.fn(),
}));

type Listener = (msg: unknown) => void;

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

  triggerMessage(msg: unknown) {
    for (const fn of this.#messageListeners) {
      fn(msg);
    }
  }

  triggerDisconnect() {
    for (const fn of this.#disconnectListeners) {
      fn();
    }
  }
}

const makeSnapshot = (
  namespace: string,
  isUnlocked: boolean,
  overrides?: Partial<ProviderBridgeSnapshot>,
): ProviderBridgeSnapshot => ({
  namespace,
  chain: { chainId: "0x1", chainRef: `${namespace}:1`, ...(overrides?.chain ?? {}) },
  isUnlocked,
  meta: {
    activeChainByNamespace: { [namespace]: `${namespace}:1` },
    supportedChains: [`${namespace}:1`],
    ...(overrides?.meta ?? {}),
  },
});

const createRouterHarness = (options?: {
  buildConnectionState?: ProviderRuntimeSurface["buildConnectionState"];
  listPermittedAccounts?: ProviderRuntimeSurface["listPermittedAccounts"];
  cancelSessionApprovals?: ProviderRuntimeSurface["cancelSessionApprovals"];
  executeRpcRequest?: ProviderRuntimeSurface["executeRpcRequest"];
  encodeRpcError?: ProviderRuntimeSurface["encodeRpcError"];
  snapshots?: Record<string, ProviderBridgeSnapshot>;
}) => {
  const listPermittedAccounts = vi.fn(
    options?.listPermittedAccounts ??
      (async ({ chainRef }) => (chainRef === "eip155:1" ? ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"] : [])),
  );
  const cancelSessionApprovals = vi.fn(options?.cancelSessionApprovals ?? (async () => 1));
  const executeRpcRequest = vi.fn(
    options?.executeRpcRequest ??
      (async (input) => {
        const payload = input;
        return {
          id: payload.id,
          jsonrpc: payload.jsonrpc,
          result: null,
        } satisfies JsonRpcResponse;
      }),
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
  const snapshots = options?.snapshots ?? {
    eip155: makeSnapshot("eip155", true, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: {
        activeChainByNamespace: { eip155: "eip155:1" },
        supportedChains: ["eip155:1"],
      },
    }),
  };
  const buildConnectionState = vi.fn(
    options?.buildConnectionState ??
      (async ({ namespace, origin }) => {
        const snapshot = snapshots[namespace];
        if (!snapshot) {
          throw new Error(`Missing snapshot for ${namespace}`);
        }

        return {
          snapshot,
          accounts: snapshot.isUnlocked
            ? await listPermittedAccounts({ origin, chainRef: snapshot.chain.chainRef })
            : [],
        };
      }),
  );

  const providerBridgeAccess: ProviderRuntimeSurface = {
    buildSnapshot: vi.fn((namespace: string) => {
      const snapshot = snapshots[namespace];
      if (!snapshot) {
        throw new Error(`Missing snapshot for ${namespace}`);
      }
      return snapshot;
    }),
    buildConnectionState,
    getActiveChainByNamespace: vi.fn(() => ({ eip155: "eip155:1" })),
    subscribeSessionUnlocked: vi.fn(() => () => {}),
    subscribeSessionLocked: vi.fn(() => () => {}),
    subscribeNetworkStateChanged: vi.fn(() => () => {}),
    subscribeNetworkPreferencesChanged: vi.fn(() => () => {}),
    subscribeAccountsStateChanged: vi.fn(() => () => {}),
    subscribePermissionsStateChanged: vi.fn(() => () => {}),
    executeRpcRequest,
    encodeRpcError,
    listPermittedAccounts,
    cancelSessionApprovals,
  };

  const getOrInitProviderBridgeAccess = vi.fn(async () => providerBridgeAccess);
  const router = createPortRouter({
    extensionOrigin: "ext://",
    getOrInitProviderBridgeAccess,
  });

  return {
    router,
    getOrInitProviderBridgeAccess,
    providerBridgeAccess,
    buildConnectionState,
    listPermittedAccounts,
    cancelSessionApprovals,
    executeRpcRequest,
    encodeRpcError,
    snapshots,
  };
};

const handshake = (port: FakePort, sessionId: string, namespace: string) => {
  port.triggerMessage({
    channel: CHANNEL,
    sessionId,
    type: "handshake",
    payload: { handshakeId: `h-${sessionId}`, namespace },
  });
};

describe("portRouter privacy and binding", () => {
  beforeEach(() => {
    vi.mocked(getPortOrigin).mockReturnValue("https://example.com");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends handshake_ack with empty accounts when locked", async () => {
    const lockedSnapshot = makeSnapshot("eip155", false, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
    });
    const { router, listPermittedAccounts } = createRouterHarness({
      listPermittedAccounts: async () => [],
      snapshots: { eip155: lockedSnapshot },
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);

    handshake(port, "s1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "handshake_ack",
        payload: expect.objectContaining({
          handshakeId: "h-s1",
          chainId: "0x1",
          chainRef: "eip155:1",
          accounts: [],
          isUnlocked: false,
          meta: lockedSnapshot.meta,
        }),
      }),
    );
    expect(listPermittedAccounts).not.toHaveBeenCalled();
  });

  it("broadcasts accountsChanged([]) when locked", async () => {
    const lockedSnapshot = makeSnapshot("eip155", false, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
    });
    const { router, listPermittedAccounts } = createRouterHarness({
      listPermittedAccounts: async () => [],
      snapshots: { eip155: lockedSnapshot },
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "s1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    router.broadcastAccountsChanged();

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    expect(port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "event",
        payload: { event: "accountsChanged", params: [[]] },
      }),
    );
    expect(listPermittedAccounts).toHaveBeenLastCalledWith({
      origin: "https://example.com",
      chainRef: "eip155:1",
    });
  });

  it("sends handshake_ack with permitted accounts from the bound chain", async () => {
    const { router, listPermittedAccounts } = createRouterHarness({
      listPermittedAccounts: async () => ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"],
      snapshots: {
        eip155: makeSnapshot("eip155", true, {
          chain: { chainId: "0x1", chainRef: "eip155:1" },
          meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
        }),
        conflux: makeSnapshot("conflux", true, {
          chain: { chainId: "0x405", chainRef: "conflux:1029" },
          meta: {
            activeChainByNamespace: { conflux: "conflux:1029" },
            supportedChains: ["conflux:1029"],
          },
        }),
      },
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "s1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(listPermittedAccounts).toHaveBeenCalledWith({
      origin: "https://example.com",
      chainRef: "eip155:1",
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "handshake_ack",
        payload: expect.objectContaining({
          accounts: ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"],
        }),
      }),
    );
  });

  it("uses runtime-provided connection state for handshake responses", async () => {
    const unlockedSnapshot = makeSnapshot("eip155", true, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
    });
    const lockedSnapshot = makeSnapshot("eip155", false, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
    });
    const { router, buildConnectionState, listPermittedAccounts, providerBridgeAccess } = createRouterHarness({
      snapshots: { eip155: unlockedSnapshot },
      buildConnectionState: async () => ({
        snapshot: lockedSnapshot,
        accounts: [],
      }),
      listPermittedAccounts: async () => ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"],
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "s1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(buildConnectionState).toHaveBeenCalledWith({
      namespace: "eip155",
      origin: "https://example.com",
    });
    expect(listPermittedAccounts).not.toHaveBeenCalled();
    expect(providerBridgeAccess.buildSnapshot).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "handshake_ack",
        payload: expect.objectContaining({
          accounts: [],
          isUnlocked: false,
        }),
      }),
    );
  });

  it("routes chainChanged only to ports bound to the matching namespace", async () => {
    const { router } = createRouterHarness({
      snapshots: {
        eip155: makeSnapshot("eip155", true, {
          chain: { chainId: "0x1", chainRef: "eip155:1" },
          meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
        }),
        conflux: makeSnapshot("conflux", true, {
          chain: { chainId: "0x405", chainRef: "conflux:1029" },
          meta: {
            activeChainByNamespace: { conflux: "conflux:1029" },
            supportedChains: ["conflux:1", "conflux:1029"],
          },
        }),
      },
    });

    const evmPort = new FakePort();
    const confluxPort = new FakePort();
    router.handleConnect(evmPort as unknown as Runtime.Port);
    router.handleConnect(confluxPort as unknown as Runtime.Port);

    handshake(evmPort, "s-evm", "eip155");
    handshake(confluxPort, "s-cfx", "conflux");
    await vi.waitFor(() => expect(evmPort.postMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(confluxPort.postMessage).toHaveBeenCalledTimes(1));

    evmPort.postMessage.mockClear();
    confluxPort.postMessage.mockClear();

    router.broadcastChainChangedForNamespaces(["conflux"]);

    expect(evmPort.postMessage).not.toHaveBeenCalled();
    expect(confluxPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event",
        payload: {
          event: "chainChanged",
          params: [
            expect.objectContaining({
              chainId: "0x405",
              chainRef: "conflux:1029",
            }),
          ],
        },
      }),
    );
  });

  it("forwards provider-bound requests with providerNamespace in rpc context", async () => {
    const { router, executeRpcRequest } = createRouterHarness();

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "s1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "request",
      id: "transport-1",
      payload: {
        id: "rpc-1",
        jsonrpc: "2.0",
        method: "wallet_requestPermissions",
      },
    });

    await vi.waitFor(() => expect(executeRpcRequest).toHaveBeenCalledTimes(1));
    const request = executeRpcRequest.mock.calls[0]?.[0] as {
      arx?: { namespace?: string; providerNamespace?: string; chainRef?: string };
    };

    expect(request.arx).toMatchObject({
      providerNamespace: "eip155",
      chainRef: "eip155:1",
    });
    expect(request.arx?.namespace).toBeUndefined();
  });

  it("cancels provider-scoped approvals when the port disconnects", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");

    const { router, cancelSessionApprovals } = createRouterHarness();

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.triggerDisconnect();

    await vi.waitFor(() =>
      expect(cancelSessionApprovals).toHaveBeenCalledWith({
        origin: "https://example.com",
        portId: "11111111-1111-4111-8111-111111111111",
        sessionId: "session-1",
      }),
    );
  });

  it("cancels provider-scoped approvals when handshake rotates the session", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");

    const { router, cancelSessionApprovals } = createRouterHarness();

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    handshake(port, "session-2", "eip155");

    await vi.waitFor(() =>
      expect(cancelSessionApprovals).toHaveBeenCalledWith({
        origin: "https://example.com",
        portId: "22222222-2222-4222-8222-222222222222",
        sessionId: "session-1",
      }),
    );

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    expect(port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "session-2",
        type: "handshake_ack",
      }),
    );
  });

  it("rejects pending requests with a disconnect error when the port disconnects", async () => {
    let resolveRequest: (value: JsonRpcResponse) => void = () => {
      throw new Error("executeRpcRequest resolver not initialized");
    };
    const { router, executeRpcRequest, encodeRpcError } = createRouterHarness({
      executeRpcRequest: (input) => {
        const payload = input;
        return new Promise<JsonRpcResponse>((resolve) => {
          resolveRequest = resolve;
          void payload;
        });
      },
      encodeRpcError: () => ({ code: 4900, message: "Disconnected" }),
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
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

    await vi.waitFor(() => expect(executeRpcRequest).toHaveBeenCalledTimes(1));

    port.triggerDisconnect();

    await vi.waitFor(() =>
      expect(port.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: "response",
          payload: {
            id: "rpc-1",
            jsonrpc: "2.0",
            error: { code: 4900, message: "Disconnected" },
          },
        }),
      ),
    );
    expect(encodeRpcError).toHaveBeenCalled();

    resolveRequest({
      id: "rpc-1",
      jsonrpc: "2.0",
      result: "0x1",
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
  });
});
