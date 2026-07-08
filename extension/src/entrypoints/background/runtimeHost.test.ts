import type { MethodExecutor } from "@arx/core/invoke";
import {
  type ApprovalDetail,
  type ApprovalListEntry,
  WALLET_UI_CALLER_ORIGIN,
  type WalletApiAttentionSnapshot,
  type WalletEvent,
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
  const walletExecutor: MethodExecutor = {
    executePath: vi.fn(async () => null),
  };
  const createWalletMethodExecutor = vi.fn(() => walletExecutor);
  const walletEventListeners = new Set<(event: WalletEvent) => void>();
  const subscribeWalletEvents = vi.fn((listener: (event: WalletEvent) => void) => {
    walletEventListeners.add(listener);
    return () => walletEventListeners.delete(listener);
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
    emitEvents: (event: WalletEvent) => {
      for (const listener of walletEventListeners) {
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
      subscribeWalletEvents,
    },
    createWalletMethodExecutor,
    subscribeWalletEvents,
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

  it("forwards wallet events to subscribers and UI entry access", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);
    createCoreRuntimeFromArxWalletRuntimeMock.mockReturnValue({
      provider: runtimeHarness.runtime.provider,
      wallet: runtimeHarness.coreWalletApi,
    });

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });

    const walletEventListener = vi.fn();
    const unsubscribe = await runtimeHost.subscribeWalletEvents(walletEventListener);
    const emitted = runtimeHarness.emitEvents({ topic: "identity", change: "all" });

    expect(runtimeHarness.subscribeWalletEvents).toHaveBeenCalledTimes(1);
    expect(walletEventListener).toHaveBeenCalledWith(emitted);

    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
    const attentionEventsListener = vi.fn();
    const unsubscribeAttention = uiEntryAccess.subscribeUnlockAttentionEvents(attentionEventsListener);

    runtimeHarness.emitEvents({ topic: "attention", change: "state" });

    expect(attentionEventsListener).toHaveBeenCalledTimes(1);
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
        proposalId: "proposal-1",
      },
      review: {
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
    const approvalEventsListener = vi.fn();
    const unsubscribe = uiEntryAccess.subscribeApprovalEvents(approvalEventsListener);

    runtimeHarness.emitEvents({ topic: "approvals", change: "queue", approvalId: "approval-1" });
    expect(approvalEventsListener).toHaveBeenCalledTimes(1);

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
