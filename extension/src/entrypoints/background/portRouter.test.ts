import { CHANNEL } from "@arx/provider/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOrigin } from "./origin";
import { createPortRouter } from "./portRouter";

vi.mock("./origin", () => ({
  resolveOrigin: vi.fn(),
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
}

const makeSnapshot = (isUnlocked: boolean) => ({
  chain: { chainId: "0x1", caip2: "eip155:1" },
  accounts: [],
  isUnlocked,
  meta: {
    activeChain: "eip155:1",
    activeNamespace: "eip155",
    supportedChains: ["eip155:1"],
  },
});

describe("portRouter privacy", () => {
  beforeEach(() => {
    vi.mocked(resolveOrigin).mockReturnValue("https://example.com");
  });

  it("sends handshake_ack with empty accounts when locked", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const ensureContext = vi.fn(async () => ({ controllers: { permissions: { getPermittedAccounts } } }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      connections: new Set(),
      pendingRequests: new Map(),
      portContexts: new Map(),
      ensureContext: ensureContext as any,
      getControllerSnapshot: () => makeSnapshot(false) as any,
      attachUiPort: vi.fn(async () => {}),
    });

    const port = new FakePort();
    router.handleConnect(port as any);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    const [ack] = vi.mocked(port.postMessage).mock.calls[0]!;
    expect(ack).toMatchObject({
      type: "handshake_ack",
      payload: { handshakeId: "h1", accounts: [], isUnlocked: false },
    });
    expect(getPermittedAccounts).not.toHaveBeenCalled();
  });

  it("broadcasts accountsChanged([]) when locked", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const ensureContext = vi.fn(async () => ({ controllers: { permissions: { getPermittedAccounts } } }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      connections: new Set(),
      pendingRequests: new Map(),
      portContexts: new Map(),
      ensureContext: ensureContext as any,
      getControllerSnapshot: () => makeSnapshot(false) as any,
      attachUiPort: vi.fn(async () => {}),
    });

    const port = new FakePort();
    router.handleConnect(port as any);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

    router.broadcastEvent("accountsChanged", [["0xignored"]]);

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
    const [, eventMessage] = vi.mocked(port.postMessage).mock.calls.map(([msg]) => msg);
    expect(eventMessage).toMatchObject({
      type: "event",
      payload: { event: "accountsChanged", params: [[]] },
    });
    expect(getPermittedAccounts).not.toHaveBeenCalled();
  });

  it("sends handshake_ack with permitted accounts when unlocked", async () => {
    const getPermittedAccounts = vi.fn(() => ["0xabc"]);
    const ensureContext = vi.fn(async () => ({ controllers: { permissions: { getPermittedAccounts } } }));

    const router = createPortRouter({
      extensionOrigin: "ext://",
      connections: new Set(),
      pendingRequests: new Map(),
      portContexts: new Map(),
      ensureContext: ensureContext as any,
      getControllerSnapshot: () => makeSnapshot(true) as any,
      attachUiPort: vi.fn(async () => {}),
    });

    const port = new FakePort();
    router.handleConnect(port as any);

    port.triggerMessage({
      channel: CHANNEL,
      sessionId: "s1",
      type: "handshake",
      payload: { handshakeId: "h1" },
    });

    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
    const [ack] = vi.mocked(port.postMessage).mock.calls[0]!;
    expect(ack).toMatchObject({
      type: "handshake_ack",
      payload: { handshakeId: "h1", accounts: ["0xabc"], isUnlocked: true },
    });
    expect(getPermittedAccounts).toHaveBeenCalledWith("https://example.com", {
      namespace: "eip155",
      chainRef: "eip155:1",
    });
  });
});
