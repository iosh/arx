import type { MethodExecutor } from "@arx/core/invoke";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import type { ApprovalDetail, ApprovalListEntry, WalletInvalidationEvent } from "@arx/core/wallet";
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
  createCoreRuntimeFromArxWalletRuntimeMock: vi.fn(),
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

  const unsubscribeBus = vi.fn();
  const subscribe = vi.fn(() => unsubscribeBus);
  const provider = {
    getConnectionState: vi.fn(async () => ({ snapshot: null, accounts: [], connected: false })),
  };
  const listPendingApprovals = vi.fn<() => Promise<ApprovalListEntry[]>>(async () => []);
  const getApprovalDetail = vi.fn<(approvalId: string) => Promise<ApprovalDetail | null>>(async () => null);
  const dismissApproval = vi.fn(async () => null);

  return {
    walletExecutor,
    emitInvalidation: (topic: WalletInvalidationEvent["topic"]) => {
      const event = { topic } satisfies WalletInvalidationEvent;
      for (const listener of invalidationListeners) {
        listener(event);
      }
      return event;
    },
    coreWalletApi: {
      approvals: {
        listPending: listPendingApprovals,
        getDetail: vi.fn(async (input?: { approvalId: string }) => await getApprovalDetail(input?.approvalId ?? "")),
        dismiss: dismissApproval,
      },
    },
    runtime: {
      bus: { subscribe },
      services: {
        sessionStatus: {
          hasInitializedVault: () => true,
        },
      },
      transactions: {},
      provider,
      createWalletMethodExecutor,
      subscribeWalletInvalidation,
      shutdown,
    },
    createWalletMethodExecutor,
    subscribeWalletInvalidation,
    shutdown,
    subscribe,
    listPendingApprovals,
    getApprovalDetail,
    dismissApproval,
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
    createCoreRuntimeFromArxWalletRuntimeMock.mockReturnValue({
      provider: runtimeHarness.runtime.provider,
      wallet: runtimeHarness.coreWalletApi,
    });

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
    createCoreRuntimeFromArxWalletRuntimeMock.mockReturnValue({
      provider: runtimeHarness.runtime.provider,
      wallet: runtimeHarness.coreWalletApi,
    });

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

  it("routes UI entry approval access through core wallet approvals", async () => {
    const runtimeHarness = makeRuntime();
    runtimeHarness.listPendingApprovals.mockResolvedValue([
      {
        approvalId: "transaction-approval-1",
        kind: "sendTransaction",
        source: "provider",
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 1_000,
      },
    ]);
    runtimeHarness.getApprovalDetail.mockResolvedValue({
      approvalId: "transaction-approval-1",
      kind: "sendTransaction",
      source: "provider",
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1_000,
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        approvalId: "transaction-approval-1",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        prepareId: "prepare-1",
      },
      review: {
        updatedAt: 1_000,
        details: null,
        prepare: {
          state: "ready",
        },
      },
    });
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);
    createCoreRuntimeFromArxWalletRuntimeMock.mockReturnValue({
      provider: runtimeHarness.runtime.provider,
      wallet: runtimeHarness.coreWalletApi,
    });

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });
    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
    const approvalInvalidationListener = vi.fn();
    const unsubscribe = uiEntryAccess.subscribeApprovalInvalidation(approvalInvalidationListener);

    runtimeHarness.emitInvalidation("approvals");
    expect(approvalInvalidationListener).toHaveBeenCalledTimes(1);

    await expect(uiEntryAccess.listPendingApprovals()).resolves.toEqual([
      {
        approvalId: "transaction-approval-1",
        kind: "sendTransaction",
        source: "provider",
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 1_000,
      },
    ]);
    await expect(uiEntryAccess.getApprovalDetail("transaction-approval-1")).resolves.toMatchObject({
      approvalId: "transaction-approval-1",
      kind: "sendTransaction",
    });

    await uiEntryAccess.dismissApproval({
      approvalId: "transaction-approval-1",
    });

    expect(runtimeHarness.listPendingApprovals).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.getApprovalDetail).toHaveBeenCalledWith("transaction-approval-1");
    expect(runtimeHarness.dismissApproval).toHaveBeenCalledWith({ approvalId: "transaction-approval-1" });
    unsubscribe();
  });
});
