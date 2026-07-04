import type { MethodExecutor } from "@arx/core/invoke";
import {
  type ApprovalDetail,
  type ApprovalListEntry,
  WALLET_UI_CALLER_ORIGIN,
  type WalletApiAttentionSnapshot,
  type WalletInvalidationEvent,
} from "@arx/core/wallet";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const { createArxWalletRuntimeMock, createCoreRuntimeFromArxWalletRuntimeMock, getExtensionStorageMock } = vi.hoisted(
  () => ({
    createArxWalletRuntimeMock: vi.fn(),
    createCoreRuntimeFromArxWalletRuntimeMock: vi.fn(),
    getExtensionStorageMock: vi.fn(),
  }),
);

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
  const provider = {
    getConnectionState: vi.fn(async () => ({ snapshot: null, accounts: [], connected: false })),
  };
  const listPendingApprovals = vi.fn<() => Promise<ApprovalListEntry[]>>(async () => []);
  const getApprovalDetail = vi.fn<(approvalId: string) => Promise<ApprovalDetail | null>>(async () => null);
  const dismissApproval = vi.fn(async () => null);
  const getAttentionSnapshot = vi.fn<() => Promise<WalletApiAttentionSnapshot>>(async () => ({
    queue: [],
    count: 0,
  }));
  const getSessionStatus = vi.fn(async () => ({
    status: "locked",
    isUnlocked: false,
    vaultInitialized: true,
    autoLockDurationMs: null,
    nextAutoLockAt: null,
  }));

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
      session: {
        getStatus: getSessionStatus,
      },
      attention: {
        getSnapshot: getAttentionSnapshot,
      },
      approvals: {
        listPending: listPendingApprovals,
        getDetail: vi.fn(async (input?: { approvalId: string }) => await getApprovalDetail(input?.approvalId ?? "")),
        dismiss: dismissApproval,
      },
    },
    runtime: {
      services: {
        attention: {
          onStateChanged: vi.fn(() => vi.fn()),
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
    listPendingApprovals,
    getApprovalDetail,
    dismissApproval,
    getAttentionSnapshot,
    getSessionStatus,
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
      },
    });
  });

  it("initializes runtime once and caches the wallet executor", async () => {
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
    const firstExecutor = await runtimeHost.getOrInitWalletMethodExecutor();
    const secondExecutor = await runtimeHost.getOrInitWalletMethodExecutor();

    expect(createArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createCoreRuntimeFromArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(provider).toBe(runtimeHarness.runtime.provider);
    expect(runtimeHarness.createWalletMethodExecutor).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.createWalletMethodExecutor).toHaveBeenCalledWith({
      origin: WALLET_UI_CALLER_ORIGIN,
    });
    expect(firstExecutor).toBe(secondExecutor);
    expect(firstExecutor).toBe(runtimeHarness.walletExecutor);
  });

  it("forwards wallet invalidations to subscribers and UI entry access", async () => {
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
    const attentionInvalidationListener = vi.fn();
    const unsubscribeAttention = uiEntryAccess.subscribeUnlockAttentionInvalidation(attentionInvalidationListener);

    runtimeHarness.emitInvalidation("attention");

    expect(attentionInvalidationListener).toHaveBeenCalledTimes(1);
    unsubscribeAttention();

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
