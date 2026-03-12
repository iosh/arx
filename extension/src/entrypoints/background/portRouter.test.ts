import type { RpcRegistry } from "@arx/core";
import { CHANNEL } from "@arx/provider/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { createPortRouter } from "./portRouter";
import type { BackgroundContext } from "./runtimeHost";
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
  getChainAuthorization?: (
    origin: string,
    params: { namespace: string; chainRef: string },
  ) => { origin: string; namespace: string; chainRef: string; accountIds: string[] } | null;
  cancelByScope?: (params: unknown) => Promise<number>;
  snapshots?: Record<string, ProviderBridgeSnapshot>;
}) => {
  const getChainAuthorization = vi.fn(
    options?.getChainAuthorization ??
      ((_origin, params) =>
        params.namespace === "eip155" && params.chainRef === "eip155:1"
          ? {
              origin: "https://example.com",
              namespace: "eip155",
              chainRef: "eip155:1",
              accountIds: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            }
          : null),
  );
  const cancelByScope = vi.fn(options?.cancelByScope ?? (async () => 1));
  const engineHandle = vi.fn((request: unknown, callback: (error: unknown, response?: unknown) => void) => {
    const payload = request as { id?: unknown; jsonrpc?: unknown };
    callback(null, {
      id: payload.id ?? "1",
      jsonrpc: payload.jsonrpc ?? "2.0",
      result: null,
    });
  });
  const registry = { getRegisteredNamespaces: () => ["eip155", "conflux"] } as unknown as RpcRegistry;
  const getOrInitContext = vi.fn(async () => ({
    engine: { handle: engineHandle },
    runtime: { rpc: { registry } },
    controllers: {
      permissions: { getChainAuthorization },
      approvals: { cancelByScope },
    },
  }));
  const snapshots = options?.snapshots ?? {
    eip155: makeSnapshot("eip155", true, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: {
        activeChainByNamespace: { eip155: "eip155:1" },
        supportedChains: ["eip155:1"],
      },
    }),
  };

  const router = createPortRouter({
    extensionOrigin: "ext://",
    getOrInitContext: getOrInitContext as unknown as () => Promise<BackgroundContext>,
    getProviderSnapshot: (namespace: string) => {
      const snapshot = snapshots[namespace];
      if (!snapshot) {
        throw new Error(`Missing snapshot for ${namespace}`);
      }
      return snapshot;
    },
  });

  return { router, getOrInitContext, getChainAuthorization, cancelByScope, engineHandle, snapshots };
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
    const { router, getChainAuthorization } = createRouterHarness({
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
    expect(getChainAuthorization).not.toHaveBeenCalled();
  });

  it("broadcasts accountsChanged([]) when locked", async () => {
    const lockedSnapshot = makeSnapshot("eip155", false, {
      chain: { chainId: "0x1", chainRef: "eip155:1" },
      meta: { activeChainByNamespace: { eip155: "eip155:1" }, supportedChains: ["eip155:1"] },
    });
    const { router, getChainAuthorization } = createRouterHarness({
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
    expect(getChainAuthorization).not.toHaveBeenCalled();
  });

  it("sends handshake_ack with permitted accounts from the bound chain", async () => {
    const { router, getChainAuthorization } = createRouterHarness({
      getChainAuthorization: () => ({
        origin: "https://example.com",
        namespace: "eip155",
        chainRef: "eip155:1",
        accountIds: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      }),
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
    expect(getChainAuthorization).toHaveBeenCalledWith("https://example.com", {
      namespace: "eip155",
      chainRef: "eip155:1",
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "handshake_ack",
        payload: expect.objectContaining({
          accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
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
    const { router, engineHandle } = createRouterHarness();

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

    await vi.waitFor(() => expect(engineHandle).toHaveBeenCalledTimes(1));
    const request = engineHandle.mock.calls[0]?.[0] as {
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

    const { router, cancelByScope } = createRouterHarness();

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);
    handshake(port, "session-1", "eip155");

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    port.triggerDisconnect();

    await vi.waitFor(() =>
      expect(cancelByScope).toHaveBeenCalledWith({
        scope: {
          transport: "provider",
          origin: "https://example.com",
          portId: "11111111-1111-4111-8111-111111111111",
          sessionId: "session-1",
        },
        reason: "session_lost",
      }),
    );
  });
});
