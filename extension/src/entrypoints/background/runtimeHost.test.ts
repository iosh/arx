import type { ProviderRuntimeSnapshot } from "@arx/core/runtime";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const {
  createArxWalletRuntimeMock,
  createCoreRuntimeFromArxWalletRuntimeMock,
  getExtensionStorageMock,
  disableDebugNamespacesMock,
  enableDebugNamespacesMock,
} = vi.hoisted(() => {
  return {
    createArxWalletRuntimeMock: vi.fn(),
    createCoreRuntimeFromArxWalletRuntimeMock: vi.fn((runtime: { provider: unknown }) => ({
      provider: runtime.provider,
      wallet: {},
    })),
    getExtensionStorageMock: vi.fn(),
    disableDebugNamespacesMock: vi.fn(),
    enableDebugNamespacesMock: vi.fn(),
  };
});

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
  const onCreated = vi.fn(() => vi.fn());
  const onFinished = vi.fn(() => vi.fn());
  const onApprovalsStateChanged = vi.fn(() => vi.fn());
  const cancelApproval = vi.fn(async () => {});
  const transactionApprovalHandlers = new Set<(approvalIds: readonly string[]) => void>();
  const transactionApprovals = new Map<string, unknown>();
  const transactions = new Map<string, unknown>();
  const onTransactionApprovalsChanged = vi.fn((handler: (approvalIds: readonly string[]) => void) => {
    transactionApprovalHandlers.add(handler);
    return () => {
      transactionApprovalHandlers.delete(handler);
    };
  });
  const getTransactionApproval = vi.fn((approvalId: string) => transactionApprovals.get(approvalId) ?? null);
  const getTransaction = vi.fn(async (transactionId: string) => transactions.get(transactionId) ?? null);
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
  const onChainRpcStateChanged = vi.fn(() => vi.fn());
  const onAccountsStateChanged = vi.fn(() => vi.fn());
  const onPermissionsStateChanged = vi.fn(() => vi.fn());
  const onUnlocked = vi.fn(() => vi.fn());
  const onLocked = vi.fn(() => vi.fn());
  const onSessionLockStateChanged = vi.fn(() => vi.fn());
  const onWalletChainSelectionChanged = vi.fn(() => vi.fn());
  const onConnectionStateChanged = vi.fn(() => vi.fn());
  const unsubscribeBus = vi.fn();
  const subscribe = vi.fn(() => unsubscribeBus);
  const providerSnapshot = {
    namespace: "eip155",
    chain: { chainId: "0x1", chainRef: "eip155:1" },
    isUnlocked: true,
  } satisfies ProviderRuntimeSnapshot;
  const provider = {
    getConnectionState: vi.fn(async () => ({
      snapshot: providerSnapshot,
      accounts: [],
      connected: false,
    })),
    subscribeSessionUnlocked: onUnlocked,
    subscribeSessionLocked: onLocked,
    activateConnectionScope: vi.fn(async () => ({
      snapshot: providerSnapshot,
      accounts: [],
    })),
    deactivateConnectionScope: vi.fn(),
    subscribeConnectionStateChanged: onConnectionStateChanged,
    request: vi.fn(),
    encodeRuntimeRpcError: vi.fn(),
    cancelRequestScope: vi.fn(async () => 0),
  };
  const createUiAccess = vi.fn();
  const walletBridgeServer = {
    handleRequest: vi.fn(),
  };
  const createWalletBridgeServer = vi.fn(() => walletBridgeServer);
  const createProvider = vi.fn(() => provider);
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

    transactionApprovals.set("transaction-approval-1", approval);
    for (const handler of transactionApprovalHandlers) {
      handler(["transaction-approval-1"]);
    }
  };

  const runtime = {
    bus: { subscribe },
    services: {
      accounts: {
        onStateChanged: onAccountsStateChanged,
      },
      approvals: {
        onCreated,
        onFinished,
        onStateChanged: onApprovalsStateChanged,
        cancel: cancelApproval,
        getState: () => ({ pending: [{ approvalId: "approval-1", source: "provider" }] }),
      },
      permissions: {
        onStateChanged: onPermissionsStateChanged,
      },
      chainRpc: {
        onStateChanged: onChainRpcStateChanged,
      },
      attention: {},
      chainActivation: {},
      chainViews: {
        getActiveChainViewForNamespace: vi.fn(() => ({
          chainId: "0x1",
          chainRef: "eip155:1",
        })),
      },
      permissionViews: {},
      accountCodecs: {},
      walletChainSelection: {
        getChainRefByNamespace: () => ({ eip155: "eip155:1" }),
        subscribeChanged: onWalletChainSelectionChanged,
      },
      session: {
        vault: {
          getStatus: () => ({ status: "locked" }),
        },
        unlock: {
          isUnlocked: () => true,
          onUnlocked,
          onLocked,
          onStateChanged: onSessionLockStateChanged,
        },
      },
      sessionStatus: {
        hasInitializedVault: () => true,
      },
      namespaceBindings: {},
      keyring: {},
    },
    rpc: {
      engine: {},
      registry: {},
      resolveHintNamespace: vi.fn(),
      resolveMethodNamespace: vi.fn(),
      resolveInvocation: vi.fn(),
      resolveInvocationDetails: vi.fn(),
      executeRequest: vi.fn(),
    },
    provider,
    wallet: {
      createProvider,
    },
    transactions: {
      onTransactionApprovalsChanged,
      getTransactionApproval,
      getTransaction,
      listTransactionApprovals,
      cancelTransactionApproval,
    },
    createUiAccess,
    createWalletBridgeServer,
    getApprovalDetail,
    shutdown,
  };

  return {
    runtime,
    provider,
    createProvider,
    createUiAccess,
    walletBridgeServer,
    createWalletBridgeServer,
    providerSnapshot,
    shutdown,
    subscribe,
    onCreated,
    onFinished,
    onApprovalsStateChanged,
    cancelApproval,
    onChainRpcStateChanged,
    onAccountsStateChanged,
    onPermissionsStateChanged,
    onUnlocked,
    onLocked,
    onSessionLockStateChanged,
    onWalletChainSelectionChanged,
    onConnectionStateChanged,
    addTransactionApproval,
    onTransactionApprovalsChanged,
    getTransactionApproval,
    getTransaction,
    listTransactionApprovals,
    cancelTransactionApproval,
  };
};

const createEntryBootstrap = (environment: "popup" | "notification" | "onboarding") => ({
  environment,
  reason:
    environment === "onboarding"
      ? ("onboarding_required" as const)
      : environment === "notification"
        ? ("idle" as const)
        : ("manual_open" as const),
  context: {
    approvalId: null,
    origin: null,
    method: null,
    chainRef: null,
    namespace: null,
  },
});

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

  it("initializes runtime once across repeated UI bridge accessors", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);
    const uiAccess = {
      dispatchRequest: vi.fn(),
      subscribeUiEvents: vi.fn(() => vi.fn()),
    };
    runtimeHarness.createUiAccess.mockReturnValue(uiAccess);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });
    const uiPlatform = {
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
    };
    const uiActivation = {
      ...uiPlatform,
      getEntryLaunchContext: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) =>
        createEntryBootstrap(environment),
      ),
      getEntryBootstrap: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
        entry: createEntryBootstrap(environment),
        requestedApproval: null,
      })),
    };

    await runtimeHost.initializeRuntime();
    const provider = await runtimeHost.getOrInitProvider();
    const firstUiAccess = await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      activation: uiActivation,
      uiOrigin: "chrome-extension://test",
    });
    const secondUiAccess = await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      activation: uiActivation,
      uiOrigin: "chrome-extension://test",
    });
    const firstWalletBridgeServer = await runtimeHost.getOrInitWalletBridgeServer("chrome-extension://test");
    const secondWalletBridgeServer = await runtimeHost.getOrInitWalletBridgeServer("chrome-extension://test");
    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();

    expect(createArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createArxWalletRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaces: installedNamespaces.engine,
      }),
    );
    expect(createCoreRuntimeFromArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createCoreRuntimeFromArxWalletRuntimeMock).toHaveBeenCalledWith(runtimeHarness.runtime);
    expect(runtimeHarness.createUiAccess).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.createUiAccess).toHaveBeenCalledWith({
      platform: uiPlatform,
      uiOrigin: "chrome-extension://test",
      extensions: [expect.objectContaining({ id: "extension.uiActivation" })],
    });
    expect(runtimeHarness.createWalletBridgeServer).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.createWalletBridgeServer).toHaveBeenCalledWith({
      uiOrigin: "chrome-extension://test",
    });
    expect(runtimeHarness.createProvider).not.toHaveBeenCalled();
    expect(provider).toBe(runtimeHarness.provider);
    expect(firstUiAccess).toBe(uiAccess);
    expect(secondUiAccess).toBe(uiAccess);
    expect(firstWalletBridgeServer).toBe(runtimeHarness.walletBridgeServer);
    expect(secondWalletBridgeServer).toBe(runtimeHarness.walletBridgeServer);
    await expect(provider.getConnectionState({ origin: "https://example.com", namespace: "eip155" })).resolves.toEqual({
      snapshot: runtimeHarness.providerSnapshot,
      accounts: [],
      connected: false,
    });
    expect(runtimeHarness.provider.getConnectionState).toHaveBeenCalledWith({
      origin: "https://example.com",
      namespace: "eip155",
    });
    expect(uiEntryAccess.hasInitializedVault()).toBe(true);

    const unlockListener = vi.fn();
    uiEntryAccess.subscribeUnlockAttentionRequested(unlockListener);
    expect(runtimeHarness.subscribe).toHaveBeenCalledWith(ATTENTION_REQUESTED, expect.any(Function));

    const attentionSubscription = (
      runtimeHarness.subscribe.mock.calls as unknown as Array<[unknown, (payload: Record<string, unknown>) => void]>
    ).find((call) => Object.is(call[0], ATTENTION_REQUESTED));
    const attentionHandler = attentionSubscription?.[1];

    expect(attentionHandler).toBeTypeOf("function");

    attentionHandler?.({
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
      requestedAt: 1_000,
      expiresAt: 2_000,
    });
    attentionHandler?.({
      reason: "approval_required",
      origin: "https://dapp.example",
      method: "personal_sign",
      chainRef: "eip155:1",
      namespace: "eip155",
      requestedAt: 1_000,
      expiresAt: 2_000,
    });

    expect(unlockListener).toHaveBeenCalledTimes(1);
    expect(unlockListener).toHaveBeenCalledWith({
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
      requestedAt: 1_000,
      expiresAt: 2_000,
    });
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
    await expect(uiEntryAccess.getPendingApprovalCount()).resolves.toBe(1);
  });

  it("shuts down runtime and allows a fresh boot on the next access", async () => {
    const runtimeHarness = makeRuntime();
    const nextRuntimeHarness = makeRuntime();
    createArxWalletRuntimeMock
      .mockResolvedValueOnce(runtimeHarness.runtime)
      .mockResolvedValueOnce(nextRuntimeHarness.runtime);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });

    await runtimeHost.initializeRuntime();
    const firstWalletBridgeServer = await runtimeHost.getOrInitWalletBridgeServer("chrome-extension://test");
    await runtimeHost.shutdown();

    expect(runtimeHarness.shutdown).toHaveBeenCalledTimes(1);
    await runtimeHost.initializeRuntime();
    const secondWalletBridgeServer = await runtimeHost.getOrInitWalletBridgeServer("chrome-extension://test");

    expect(createArxWalletRuntimeMock).toHaveBeenCalledTimes(2);
    expect(nextRuntimeHarness.shutdown).not.toHaveBeenCalled();
    expect(firstWalletBridgeServer).toBe(runtimeHarness.walletBridgeServer);
    expect(secondWalletBridgeServer).toBe(nextRuntimeHarness.walletBridgeServer);
    expect(runtimeHarness.createWalletBridgeServer).toHaveBeenCalledTimes(1);
    expect(nextRuntimeHarness.createWalletBridgeServer).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated UI access requests with different parameters", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);
    const uiAccess = {
      dispatchRequest: vi.fn(),
      subscribeUiEvents: vi.fn(() => vi.fn()),
    };
    runtimeHarness.createUiAccess.mockReturnValue(uiAccess);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });
    const uiPlatform = {
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
    };
    const uiActivation = {
      ...uiPlatform,
      getEntryLaunchContext: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) =>
        createEntryBootstrap(environment),
      ),
      getEntryBootstrap: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
        entry: createEntryBootstrap(environment),
        requestedApproval: null,
      })),
    };

    await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      activation: uiActivation,
      uiOrigin: "chrome-extension://test",
    });

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        activation: uiActivation,
        uiOrigin: "chrome-extension://different",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: {
          openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
          openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
        },
        activation: uiActivation,
        uiOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        activation: {
          openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
          getEntryLaunchContext: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) =>
            createEntryBootstrap(environment),
          ),
          getEntryBootstrap: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
            entry: createEntryBootstrap(environment),
            requestedApproval: null,
          })),
        },
        uiOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    expect(runtimeHarness.createUiAccess).toHaveBeenCalledTimes(1);
  });
});
