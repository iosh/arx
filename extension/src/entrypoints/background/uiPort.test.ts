import type { MethodExecutor } from "@arx/core/invoke";
import { WALLET_CHANGED_EVENT, WALLET_TARGET, type WalletEvent } from "@arx/core/wallet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_ENTRY_CHANGED_EVENT, HOST_TARGET, UI_CHANNEL, type UiEntryLaunchContext } from "@/lib/host";
import { createBackgroundUiPort } from "./uiPort";

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

class FakePort {
  name = UI_CHANNEL;
  messages: unknown[] = [];
  #messageListeners = new Set<MessageListener>();
  #disconnectListeners = new Set<DisconnectListener>();

  postMessage = (message: unknown) => {
    this.messages.push(message);
  };

  onMessage = {
    addListener: (listener: MessageListener) => this.#messageListeners.add(listener),
    removeListener: (listener: MessageListener) => this.#messageListeners.delete(listener),
  };

  onDisconnect = {
    addListener: (listener: DisconnectListener) => this.#disconnectListeners.add(listener),
    removeListener: (listener: DisconnectListener) => this.#disconnectListeners.delete(listener),
  };

  emitMessage(message: unknown) {
    for (const listener of Array.from(this.#messageListeners)) {
      listener(message);
    }
  }
}

const popupEntry: UiEntryLaunchContext = {
  environment: "popup",
  reason: "manual_open",
  context: {
    approvalId: null,
    origin: null,
    method: null,
    chainRef: null,
    namespace: null,
  },
};

describe("createBackgroundUiPort", () => {
  let walletEventListener: ((event: WalletEvent) => void) | null;
  let walletExecutor: MethodExecutor;

  beforeEach(() => {
    walletEventListener = null;
    walletExecutor = {
      executePath: vi.fn(async (path) => ({ path })),
    };
  });

  it("routes host and wallet calls through the shared executors", async () => {
    const uiPort = createBackgroundUiPort({
      runtimeHost: {
        getOrInitWalletMethodExecutor: vi.fn(async () => walletExecutor),
        subscribeWalletEvents: vi.fn(async (listener) => {
          walletEventListener = listener;
          return () => {
            walletEventListener = null;
          };
        }),
      },
      host: {
        getEntryLaunchContext: vi.fn(() => popupEntry),
        getEntryBootstrap: vi.fn(async () => ({ entry: popupEntry, requestedApproval: null })),
        openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      },
    });

    await uiPort.start();

    const port = new FakePort();
    uiPort.attachPort(port as never);

    expect(port.messages).toContainEqual({ kind: "ready" });

    port.emitMessage({
      kind: "invoke",
      target: HOST_TARGET,
      id: "host-1",
      action: "entry.getLaunchContext",
      input: { environment: "popup" },
    });

    await vi.waitFor(() =>
      expect(port.messages).toContainEqual({
        kind: "result",
        target: HOST_TARGET,
        id: "host-1",
        output: popupEntry,
      }),
    );

    port.emitMessage({
      kind: "invoke",
      target: WALLET_TARGET,
      id: "wallet-1",
      action: "session.getStatus",
    });

    await vi.waitFor(() =>
      expect(port.messages).toContainEqual({
        kind: "result",
        target: WALLET_TARGET,
        id: "wallet-1",
        output: { path: "session.getStatus" },
      }),
    );
    expect(walletExecutor.executePath).toHaveBeenCalledWith("session.getStatus", undefined);
  });

  it("broadcasts wallet events and host entry changes to attached ports", async () => {
    const uiPort = createBackgroundUiPort({
      runtimeHost: {
        getOrInitWalletMethodExecutor: vi.fn(async () => walletExecutor),
        subscribeWalletEvents: vi.fn(async (listener) => {
          walletEventListener = listener;
          return () => {
            walletEventListener = null;
          };
        }),
      },
      host: {
        getEntryLaunchContext: vi.fn(() => popupEntry),
        getEntryBootstrap: vi.fn(async () => ({ entry: popupEntry, requestedApproval: null })),
        openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      },
    });

    await uiPort.start();

    const firstPort = new FakePort();
    const secondPort = new FakePort();
    uiPort.attachPort(firstPort as never);
    uiPort.attachPort(secondPort as never);
    firstPort.messages = [];
    secondPort.messages = [];

    const walletEvent = { topic: "identity", change: "all" } satisfies WalletEvent;
    walletEventListener?.(walletEvent);
    uiPort.broadcastEntryChanged(popupEntry);

    expect(firstPort.messages).toContainEqual({
      kind: "event",
      target: WALLET_TARGET,
      name: WALLET_CHANGED_EVENT,
      payload: walletEvent,
    });
    expect(secondPort.messages).toContainEqual({
      kind: "event",
      target: HOST_TARGET,
      name: HOST_ENTRY_CHANGED_EVENT,
      payload: popupEntry,
    });
  });
});
