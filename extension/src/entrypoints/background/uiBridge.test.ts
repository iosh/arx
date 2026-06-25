import type { UiRuntimeAccess } from "@arx/core/runtime";
import { UI_CHANNEL, UI_EVENT_READY, type UiPortEnvelope } from "@arx/core/ui";
import {
  WALLET_BRIDGE_PROTOCOL_VERSION,
  type WalletBridgeInvalidationEvent,
  type WalletBridgeReply,
  type WalletBridgeRequest,
  type WalletBridgeServer,
  type WalletInvalidationTopic,
} from "@arx/core/wallet/bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UiPort } from "./ui/portHub";
import { createUiBridge } from "./uiBridge";

type Listener = (msg: unknown) => void | Promise<void>;

class FakePort {
  name = UI_CHANNEL;
  messages: unknown[] = [];
  shouldThrowOnPostMessage = false;
  #messageListeners = new Set<Listener>();
  #disconnectListeners = new Set<() => void>();

  postMessage = (msg: unknown) => {
    if (this.shouldThrowOnPostMessage) {
      throw new Error("stale port");
    }

    this.messages.push(msg);
  };

  onMessage = {
    addListener: (fn: Listener) => this.#messageListeners.add(fn),
    removeListener: (fn: Listener) => this.#messageListeners.delete(fn),
  };

  onDisconnect = {
    addListener: (fn: () => void) => this.#disconnectListeners.add(fn),
    removeListener: (fn: () => void) => this.#disconnectListeners.delete(fn),
  };

  async triggerMessage(msg: unknown) {
    for (const fn of Array.from(this.#messageListeners)) {
      await fn(msg);
    }
  }

  disconnect() {
    for (const fn of Array.from(this.#disconnectListeners)) {
      fn();
    }
  }
}

const createPort = () => new FakePort();

const createUiAccess = (overrides?: Partial<UiRuntimeAccess>) => {
  const uiAccess: UiRuntimeAccess = {
    dispatchRequest: vi.fn(async () => null),
    ...overrides,
  };

  return { uiAccess };
};

const createWalletBridgeServerHarness = (
  handleRequest: WalletBridgeServer["handleRequest"] = vi.fn(
    async (request: WalletBridgeRequest): Promise<WalletBridgeReply> => ({
      type: "wallet:response",
      version: WALLET_BRIDGE_PROTOCOL_VERSION,
      id: request.id,
      result: null,
    }),
  ),
) => {
  const invalidationListeners = new Set<(event: WalletBridgeInvalidationEvent) => void>();
  const server: WalletBridgeServer = {
    handleRequest,
    subscribeInvalidation: vi.fn((listener) => {
      invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    }),
  };

  return {
    server,
    emitInvalidation: (topic: WalletInvalidationTopic) => {
      const event: WalletBridgeInvalidationEvent = {
        type: "wallet:event",
        version: WALLET_BRIDGE_PROTOCOL_VERSION,
        event: "wallet:invalidation",
        topic,
      };

      for (const listener of invalidationListeners) {
        listener(event);
      }

      return event;
    },
  };
};

const attachReadyPort = (bridge: ReturnType<typeof createUiBridge>) => {
  const port = createPort();
  bridge.attachPort(port as unknown as UiPort);
  port.messages = [];
  return port;
};

describe("uiBridge", () => {
  let uiAccess: UiRuntimeAccess;
  let walletBridgeServer: WalletBridgeServer;
  let walletBridgeHarness: ReturnType<typeof createWalletBridgeServerHarness>;
  let bridge: ReturnType<typeof createUiBridge>;

  beforeEach(() => {
    const ui = createUiAccess();
    uiAccess = ui.uiAccess;
    walletBridgeHarness = createWalletBridgeServerHarness();
    walletBridgeServer = walletBridgeHarness.server;
    bridge = createUiBridge({ uiAccess, walletBridgeServer });
  });

  it("sends the ready handshake when a UI port attaches", () => {
    const port = createPort();

    bridge.attachPort(port as unknown as UiPort);

    expect(port.messages).toContainEqual({
      type: "ui:event",
      event: UI_EVENT_READY,
      payload: { ready: true },
    });
  });

  it("routes wallet requests to the wallet bridge server", async () => {
    const handleRequest = vi.fn(
      async (request: WalletBridgeRequest): Promise<WalletBridgeReply> => ({
        type: "wallet:response",
        version: WALLET_BRIDGE_PROTOCOL_VERSION,
        id: request.id,
        result: { availability: "ready" },
      }),
    );
    const localWalletBridgeHarness = createWalletBridgeServerHarness(handleRequest);
    const localBridge = createUiBridge({
      uiAccess,
      walletBridgeServer: localWalletBridgeHarness.server,
    });
    const port = attachReadyPort(localBridge);

    await port.triggerMessage({
      type: "wallet:request",
      version: WALLET_BRIDGE_PROTOCOL_VERSION,
      id: "wallet-request-1",
      path: "setup.getStatus",
    });

    expect(handleRequest).toHaveBeenCalledWith({
      type: "wallet:request",
      version: WALLET_BRIDGE_PROTOCOL_VERSION,
      id: "wallet-request-1",
      path: "setup.getStatus",
    });
    expect(uiAccess.dispatchRequest).not.toHaveBeenCalled();
    expect(port.messages).toContainEqual({
      type: "wallet:response",
      version: WALLET_BRIDGE_PROTOCOL_VERSION,
      id: "wallet-request-1",
      result: { availability: "ready" },
    });
  });

  it("routes ui requests to ui runtime access", async () => {
    const reply: UiPortEnvelope = {
      type: "ui:response",
      id: "ui-request-1",
      result: {
        environment: "popup",
        reason: "manual_open",
        context: {
          approvalId: null,
          origin: null,
          method: null,
          chainRef: null,
          namespace: null,
        },
      },
    };
    vi.mocked(uiAccess.dispatchRequest).mockResolvedValueOnce({ reply, kind: "query" });
    const port = attachReadyPort(bridge);

    await port.triggerMessage({
      type: "ui:request",
      id: "ui-request-1",
      method: "ui.entry.getLaunchContext",
      params: { environment: "popup" },
    });

    expect(walletBridgeServer.handleRequest).not.toHaveBeenCalled();
    expect(uiAccess.dispatchRequest).toHaveBeenCalledWith({
      type: "ui:request",
      id: "ui-request-1",
      method: "ui.entry.getLaunchContext",
      params: { environment: "popup" },
    });
    expect(port.messages).toContainEqual(reply);
  });

  it("does not block wallet invalidations behind slow ui requests", async () => {
    let resolveDispatch!: (value: Awaited<ReturnType<UiRuntimeAccess["dispatchRequest"]>>) => void;
    let hasPendingDispatch = false;
    const ui = createUiAccess({
      dispatchRequest: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<UiRuntimeAccess["dispatchRequest"]>>>((resolve) => {
            resolveDispatch = resolve;
            hasPendingDispatch = true;
          }),
      ),
    });
    const localWalletBridgeHarness = createWalletBridgeServerHarness();
    const localBridge = createUiBridge({
      uiAccess: ui.uiAccess,
      walletBridgeServer: localWalletBridgeHarness.server,
    });
    const queryPort = attachReadyPort(localBridge);
    const observerPort = attachReadyPort(localBridge);

    const pendingQuery = queryPort.triggerMessage({
      type: "ui:request",
      id: "ui-request-1",
      method: "ui.entry.getLaunchContext",
      params: { environment: "popup" },
    });
    await vi.waitFor(() => expect(hasPendingDispatch).toBe(true));

    const invalidation = localWalletBridgeHarness.emitInvalidation("accounts");

    expect(observerPort.messages).toContainEqual(invalidation);
    expect(queryPort.messages).not.toContainEqual(expect.objectContaining({ type: "ui:response", id: "ui-request-1" }));

    resolveDispatch({
      reply: {
        type: "ui:response",
        id: "ui-request-1",
        result: null,
      },
      kind: "query",
    });
    await pendingQuery;

    expect(queryPort.messages).toContainEqual(invalidation);
    expect(queryPort.messages.at(-1)).toEqual({
      type: "ui:response",
      id: "ui-request-1",
      result: null,
    });
  });

  it("drops a stale port without affecting other attached ports", () => {
    const stalePort = attachReadyPort(bridge);
    const healthyPort = attachReadyPort(bridge);
    stalePort.shouldThrowOnPostMessage = true;

    const firstInvalidation = walletBridgeHarness.emitInvalidation("accounts");

    expect(stalePort.messages).toEqual([]);
    expect(healthyPort.messages).toContainEqual(firstInvalidation);

    healthyPort.messages = [];
    stalePort.shouldThrowOnPostMessage = false;
    const secondInvalidation = walletBridgeHarness.emitInvalidation("balances");

    expect(stalePort.messages).toEqual([]);
    expect(healthyPort.messages).toContainEqual(secondInvalidation);
  });
});
