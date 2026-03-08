import type { RpcRegistry } from "@arx/core";
import { CHANNEL, PROVIDER_EVENTS } from "@arx/provider/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { createPortRouter } from "./portRouter";
import type { BackgroundContext } from "./runtimeHost";
import type { ControllerSnapshot } from "./types";

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

const makeSnapshot = (isUnlocked: boolean, overrides?: Partial<ControllerSnapshot>): ControllerSnapshot => ({
  chain: { chainId: "0x1", chainRef: "eip155:1", ...(overrides?.chain ?? {}) },
  accounts: overrides?.accounts ?? [],
  isUnlocked,
  meta: {
    activeChain: "eip155:1",
    activeNamespace: "eip155",
    activeChainByNamespace: { eip155: "eip155:1" },
    supportedChains: ["eip155:1"],
    ...(overrides?.meta ?? {}),
  },
});

describe("portRouter privacy", () => {
  beforeEach(() => {
    vi.mocked(getPortOrigin).mockReturnValue("https://example.com");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends handshake_ack with empty accounts when locked", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const registry = { getRegisteredNamespaces: () => ["eip155"] } as unknown as RpcRegistry;
    const getOrInitContext = vi.fn(async () => ({
      runtime: { rpc: { registry } },
      controllers: { permissions: { getPermittedAccounts } },
    }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      getOrInitContext: getOrInitContext as unknown as () => Promise<BackgroundContext>,
      getControllerSnapshot: (): ControllerSnapshot => makeSnapshot(false),
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    const firstCall = vi.mocked(port.postMessage).mock.calls[0];
    if (!firstCall) throw new Error("Expected port.postMessage to be called");
    const [ack] = firstCall;
    expect(ack).toMatchObject({
      type: "handshake_ack",
      payload: { handshakeId: "h1", accounts: [], isUnlocked: false },
    });
    expect(getPermittedAccounts).not.toHaveBeenCalled();
  });

  it("broadcasts accountsChanged([]) when locked", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const registry = { getRegisteredNamespaces: () => ["eip155"] } as unknown as RpcRegistry;
    const getOrInitContext = vi.fn(async () => ({
      runtime: { rpc: { registry } },
      controllers: { permissions: { getPermittedAccounts } },
    }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      getOrInitContext: getOrInitContext as unknown as () => Promise<BackgroundContext>,
      getControllerSnapshot: (): ControllerSnapshot => makeSnapshot(false),
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    router.broadcastEvent(PROVIDER_EVENTS.accountsChanged, [["0xignored"]]);

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    const [, eventMessage] = vi.mocked(port.postMessage).mock.calls.map(([msg]) => msg);
    expect(eventMessage).toMatchObject({
      type: "event",
      payload: { event: PROVIDER_EVENTS.accountsChanged, params: [[]] },
    });
    expect(getPermittedAccounts).not.toHaveBeenCalled();
  });

  it("sends handshake_ack with permitted accounts when unlocked", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const registry = { getRegisteredNamespaces: () => ["eip155"] } as unknown as RpcRegistry;
    const getOrInitContext = vi.fn(async () => ({
      runtime: { rpc: { registry } },
      controllers: { permissions: { getPermittedAccounts } },
    }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      getOrInitContext: getOrInitContext as unknown as () => Promise<BackgroundContext>,
      getControllerSnapshot: (): ControllerSnapshot => makeSnapshot(true),
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    const firstCall = vi.mocked(port.postMessage).mock.calls[0];
    if (!firstCall) throw new Error("Expected port.postMessage to be called");
    const [ack] = firstCall;
    expect(ack).toMatchObject({
      type: "handshake_ack",
      payload: { handshakeId: "h1", accounts: ["0xabc"], isUnlocked: true },
    });
    expect(getPermittedAccounts).toHaveBeenCalledWith("https://example.com", {
      namespace: "eip155",
      chainRef: "eip155:1",
    });
  });

  it("derives permission context from provider meta active chain instead of snapshot.chain", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const registry = { getRegisteredNamespaces: () => ["eip155", "solana"] } as unknown as RpcRegistry;
    const getOrInitContext = vi.fn(async () => ({
      runtime: { rpc: { registry } },
      controllers: { permissions: { getPermittedAccounts } },
    }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      getOrInitContext: getOrInitContext as unknown as () => Promise<BackgroundContext>,
      getControllerSnapshot: (): ControllerSnapshot =>
        makeSnapshot(true, {
          chain: { chainId: "101", chainRef: "solana:101" },
          meta: {
            activeChain: "eip155:1",
            activeNamespace: "eip155",
            activeChainByNamespace: { eip155: "eip155:1", solana: "solana:101" },
            supportedChains: ["eip155:1", "solana:101"],
          },
        }),
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    expect(getPermittedAccounts).toHaveBeenCalledWith("https://example.com", {
      namespace: "eip155",
      chainRef: "eip155:1",
    });
  });

  it("cancels provider-scoped approvals when the port disconnects", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");

    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const cancelByScope = vi.fn(async () => 1);
    const registry = { getRegisteredNamespaces: () => ["eip155"] } as unknown as RpcRegistry;
    const getOrInitContext = vi.fn(async () => ({
      runtime: { rpc: { registry } },
      controllers: {
        permissions: { getPermittedAccounts },
        approvals: { cancelByScope },
      },
    }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      getOrInitContext: getOrInitContext as unknown as () => Promise<BackgroundContext>,
      getControllerSnapshot: (): ControllerSnapshot => makeSnapshot(true),
    });

    const port = new FakePort();
    router.handleConnect(port as unknown as Runtime.Port);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "session-1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

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
