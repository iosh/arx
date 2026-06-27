import type { MethodExecutor } from "@arx/core/invoke";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import type { WalletInvalidationEvent } from "@arx/core/wallet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const {
  createArxWalletRuntimeMock,
  createCoreRuntimeFromArxWalletRuntimeMock,
  getExtensionStorageMock,
  disableDebugNamespacesMock,
  enableDebugNamespacesMock,
} = vi.hoisted(() => ({
  createArxWalletRuntimeMock: vi.fn(),
  createCoreRuntimeFromArxWalletRuntimeMock: vi.fn((runtime: { provider: unknown }) => ({
    provider: runtime.provider,
    wallet: {},
  })),
  getExtensionStorageMock: vi.fn(),
  disableDebugNamespacesMock: vi.fn(),
  enableDebugNamespacesMock: vi.fn(),
}));

const { installedNamespaces } = vi.hoisted(() => ({
  installedNamespaces: {
    engine: {
      modules: [],
    },
  } as const,
}));

vi.mock("@arx/core/engine", () => ({
  createArxWalletRuntime: createArxWalletRuntimeMock,
  createCoreRuntimeFromArxWalletRuntime: createCoreRuntimeFromArxWalletRuntimeMock,
}));

vi.mock("@/platform/namespaces/installed", () => ({
  INSTALLED_NAMESPACES: installedNamespaces,
}));

vi.mock("@/platform/storage", () => ({
  getExtensionStorage: getExtensionStorageMock,
}));

vi.mock("@arx/core/logger", () => ({
  createLogger: () => vi.fn(),
  extendLogger: () => vi.fn(),
  disableDebugNamespaces: disableDebugNamespacesMock,
  enableDebugNamespaces: enableDebugNamespacesMock,
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      id: "runtime-id",
    },
  },
}));

const makeRuntime = () => {
  const shutdown = vi.fn(async () => {});
  const walletExecutor: MethodExecutor = {
    executePath: vi.fn(async () => null),
  };
  const createWalletMethodExecutor = vi.fn(() => walletExecutor);
  const invalidationListeners = new Set<(event: WalletInvalidationEvent) => void>();
  const subscribeWalletInvalidation = vi.fn((listener: (event: WalletInvalidationEvent) => void) => {
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
  });

  const onCreated = vi.fn(() => vi.fn());
  const onFinished = vi.fn(() => vi.fn());
  const onApprovalsStateChanged = vi.fn(() => vi.fn());
  const cancelApproval = vi.fn(async () => {});
  const transactionApprovalHandlers = new Set<(approvalIds: readonly string[]) => void>();
  const transactionApprovals = new Map<string, unknown>();
  const onTransactionApprovalsChanged = vi.fn((handler: (approvalIds: readonly string[]) => void) => {
    transactionApprovalHandlers.add(handler);
    return () => transactionApprovalHandlers.delete(handler);
  });
  const getTransactionApproval = vi.fn((approvalId: string) => transactionApprovals.get(approvalId) ?? null);
  const listTransactionApprovals = vi.fn(async () => Array.from(transactionApprovals.values()));
  const cancelTransactionApproval = vi.fn(async ({ approvalId }: { approvalId: string }) => {
    const approval = transactionApprovals.get(approvalId) ?? null;
    if (!approval) {
      return null;
    }

    transactionApprovals.delete(approvalId);
    for (const handler of transactionApprovalHandlers) {
      handler([approvalId]);
    }
    return approval;
  });

  const onLocked = vi.fn(() => vi.fn());
  const unsubscribeBus = vi.fn();
  const subscribe = vi.fn(() => unsubscribeBus);
  const provider = {
    getConnectionState: vi.fn(async () => ({ snapshot: null, accounts: [], connected: false })),
  };
  const getApprovalDetail = vi.fn(async () => null);

  const addTransactionApproval = () => {
    const approval = {
      approvalId: "transaction-approval-1",
      source: "provider",
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1_000,
    };

    transactionApprovals.set(approval.approvalId, approval);
    for (const handler of transactionApprovalHandlers) {
      handler([approval.approvalId]);
    }
  };

  return {
    walletExecutor,
    emitInvalidation: (topic: WalletInvalidationEvent["topic"]) => {
      const event = { topic } satisfies WalletInvalidationEvent;
      for (const listener of invalidationListeners) {
        listener(event);
      }
      return event;
    },
    addTransactionApproval,
    runtime: {
      bus: { subscribe },
      services: {
        approvals: {
          onCreated,
          onFinished,
          onStateChanged: onApprovalsStateChanged,
          cancel: cancelApproval,
          getState: () => ({ pending: [{ approvalId: "approval-1", source: "provider" }] }),
        },
        session: {
          unlock: {
            onLocked,
          },
        },
        sessionStatus: {
          hasInitializedVault: () => true,
        },
      },
      transactions: {
        onTransactionApprovalsChanged,
        getTransactionApproval,
        listTransactionApprovals,
        cancelTransactionApproval,
      },
      provider,
      createWalletMethodExecutor,
      subscribeWalletInvalidation,
      getApprovalDetail,
      shutdown,
    },
    createWalletMethodExecutor,
    subscribeWalletInvalidation,
    shutdown,
    subscribe,
    cancelApproval,
    cancelTransactionApproval,
  };
};

describe("runtimeHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExtensionStorageMock.mockReturnValue({
      ports: {
        vault: {},
        keyrings: {},
        accounts: {},
        permissions: {},
        transactions: {},
        chains: {
          chainDefinitions: {},
          chainRpcDefaultEndpoints: {},
          chainRpcEndpointOverrides: {},
          walletChainSelection: {},
          providerChainSelection: {},
        },
        settings: {},
      },
    });
  });

  it("initializes runtime once and caches the wallet executor for a stable origin", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });

    await runtimeHost.initializeRuntime();
    const provider = await runtimeHost.getOrInitProvider();
    const firstExecutor = await runtimeHost.getOrInitWalletMethodExecutor("chrome-extension://test");
    const secondExecutor = await runtimeHost.getOrInitWalletMethodExecutor("chrome-extension://test");

    expect(createArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createCoreRuntimeFromArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(provider).toBe(runtimeHarness.runtime.provider);
    expect(firstExecutor).toBe(runtimeHarness.walletExecutor);
    expect(secondExecutor).toBe(runtimeHarness.walletExecutor);
    expect(runtimeHarness.createWalletMethodExecutor).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.createWalletMethodExecutor).toHaveBeenCalledWith({
      origin: "chrome-extension://test",
    });

    await expect(runtimeHost.getOrInitWalletMethodExecutor("https://different.example")).rejects.toThrow(
      "origin must remain stable",
    );
  });

  it("forwards wallet invalidations and runtime bus events", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });

    const invalidationListener = vi.fn();
    const unsubscribe = await runtimeHost.subscribeWalletInvalidation(invalidationListener);
    const emitted = runtimeHarness.emitInvalidation("accounts");

    expect(runtimeHarness.subscribeWalletInvalidation).toHaveBeenCalledTimes(1);
    expect(invalidationListener).toHaveBeenCalledWith(emitted);

    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
    const unlockListener = vi.fn();
    uiEntryAccess.subscribeUnlockAttentionRequested(unlockListener);

    const busSubscriptions = runtimeHarness.subscribe.mock.calls as unknown as Array<
      [unknown, (payload: Record<string, unknown>) => void]
    >;
    const attentionHandler = busSubscriptions.find((call) => Object.is(call[0], ATTENTION_REQUESTED))?.[1];
    if (!attentionHandler) {
      throw new Error("attention handler was not registered");
    }

    attentionHandler({
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
      requestedAt: 1_000,
      expiresAt: 2_000,
    });

    expect(unlockListener).toHaveBeenCalledWith({
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
      requestedAt: 1_000,
      expiresAt: 2_000,
    });

    unsubscribe();
  });

  it("exposes transaction approvals through the UI entry approval stream", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });
    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
    const createdListener = vi.fn();
    const finishedListener = vi.fn();

    uiEntryAccess.subscribeApprovalCreated(createdListener);
    uiEntryAccess.subscribeApprovalFinished(finishedListener);

    runtimeHarness.addTransactionApproval();
    runtimeHarness.addTransactionApproval();

    await vi.waitFor(() => expect(createdListener).toHaveBeenCalledTimes(1));
    expect(createdListener).toHaveBeenCalledWith({
      approval: {
        approvalId: "transaction-approval-1",
        kind: "sendTransaction",
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 1_000,
        source: "provider",
      },
    });
    await expect(uiEntryAccess.getPendingApprovalCount()).resolves.toBe(2);

    await uiEntryAccess.cancelApproval({
      approvalId: "transaction-approval-1",
      reason: "user_dismissed",
    });

    expect(runtimeHarness.cancelTransactionApproval).toHaveBeenCalledWith({
      approvalId: "transaction-approval-1",
      reason: expect.objectContaining({
        kind: "approval_cancelled",
        code: "ui.user_dismissed",
      }),
    });
    expect(runtimeHarness.cancelApproval).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(finishedListener).toHaveBeenCalledWith({
        approvalId: "transaction-approval-1",
      }),
    );
  });
});
