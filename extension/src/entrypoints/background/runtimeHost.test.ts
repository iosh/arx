import { ATTENTION_REQUESTED } from "@arx/core/services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const { createArxWalletRuntimeMock, getExtensionStorageMock, disableDebugNamespacesMock, enableDebugNamespacesMock } =
  vi.hoisted(() => ({
    createArxWalletRuntimeMock: vi.fn(),
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
  const onNetworkStateChanged = vi.fn(() => vi.fn());
  const onAccountsStateChanged = vi.fn(() => vi.fn());
  const onPermissionsStateChanged = vi.fn(() => vi.fn());
  const onUnlocked = vi.fn(() => vi.fn());
  const onLocked = vi.fn(() => vi.fn());
  const onUnlockStateChanged = vi.fn(() => vi.fn());
  const subscribeNetworkPreferencesChanged = vi.fn(() => vi.fn());
  const unsubscribeBus = vi.fn();
  const subscribe = vi.fn(() => unsubscribeBus);
  const providerSnapshot = {
    namespace: "eip155",
    chain: { chainId: "0x1", chainRef: "eip155:1" },
    isUnlocked: true,
    meta: {
      activeChainByNamespace: { eip155: "eip155:1" },
      supportedChains: ["eip155:1"],
    },
  };
  const provider = {
    buildSnapshot: vi.fn(() => providerSnapshot),
    buildConnectionProjection: vi.fn(async () => ({
      snapshot: providerSnapshot,
      accounts: [],
      connected: false,
    })),
    subscribeSessionUnlocked: onUnlocked,
    subscribeSessionLocked: onLocked,
    subscribeNetworkStateChanged: onNetworkStateChanged,
    subscribeNetworkPreferencesChanged: subscribeNetworkPreferencesChanged,
    subscribeAccountsStateChanged: onAccountsStateChanged,
    subscribePermissionsStateChanged: onPermissionsStateChanged,
    connect: vi.fn(() => ({
      snapshot: providerSnapshot,
      accounts: [],
      connected: false,
    })),
    disconnect: vi.fn(() => ({
      snapshot: providerSnapshot,
      accounts: [],
      connected: false,
    })),
    disconnectOrigin: vi.fn(() => 0),
    executeRpcRequest: vi.fn(),
    encodeRpcError: vi.fn(),
    cancelSessionApprovals: vi.fn(async () => 0),
  };
  const createUiAccess = vi.fn();
  const createProvider = vi.fn(() => provider);

  const runtime = {
    bus: { subscribe },
    controllers: {
      accounts: {
        onStateChanged: onAccountsStateChanged,
      },
      network: {
        onStateChanged: onNetworkStateChanged,
      },
      approvals: {
        onCreated,
        onFinished,
        onStateChanged: onApprovalsStateChanged,
        cancel: cancelApproval,
        getState: () => ({ pending: [{ id: "approval-1" }] }),
      },
      permissions: {
        onStateChanged: onPermissionsStateChanged,
      },
      transactions: {},
    },
    services: {
      attention: {},
      chainActivation: {},
      chainViews: {
        buildProviderMeta: vi.fn(() => ({
          activeChainByNamespace: { eip155: "eip155:1" },
          supportedChains: ["eip155:1"],
        })),
        getActiveChainViewForNamespace: vi.fn(() => ({
          chainId: "0x1",
          chainRef: "eip155:1",
        })),
      },
      permissionViews: {},
      accountCodecs: {},
      networkPreferences: {
        getActiveChainByNamespace: () => ({ eip155: "eip155:1" }),
        subscribeChanged: subscribeNetworkPreferencesChanged,
      },
      session: {
        vault: {
          getStatus: () => ({ hasEnvelope: true }),
        },
        unlock: {
          isUnlocked: () => true,
          onUnlocked,
          onLocked,
          onStateChanged: onUnlockStateChanged,
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
      resolveContextNamespace: vi.fn(),
      resolveMethodNamespace: vi.fn(),
      resolveInvocation: vi.fn(),
      resolveInvocationDetails: vi.fn(),
      executeRequest: vi.fn(),
    },
    surfaceErrors: {
      encodeUi: vi.fn(),
      encodeDapp: vi.fn(),
      encodeSurfaceError: vi.fn(),
      executeWithEncoding: vi.fn(),
    },
    wallet: {
      createProvider,
    },
    createUiAccess,
    shutdown,
  };

  return {
    runtime,
    provider,
    createProvider,
    createUiAccess,
    providerSnapshot,
    shutdown,
    subscribe,
    onCreated,
    onFinished,
    onApprovalsStateChanged,
    cancelApproval,
    onNetworkStateChanged,
    onAccountsStateChanged,
    onPermissionsStateChanged,
    onUnlocked,
    onLocked,
    onUnlockStateChanged,
    subscribeNetworkPreferencesChanged,
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
        accounts: {},
        keyringMetas: {},
        permissions: {},
        transactions: {},
        networkPreferences: {},
        vaultMeta: {},
        settings: {},
        chainDefinitions: {},
      },
    });
  });

  it("initializes runtime once across repeated UI bridge accessors", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);
    const uiAccess = {
      buildSnapshotEvent: vi.fn(),
      dispatchRequest: vi.fn(),
      getRequestBroadcastPolicy: vi.fn(),
      subscribeStateChanged: vi.fn(() => vi.fn()),
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
    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();

    expect(createArxWalletRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createArxWalletRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaces: installedNamespaces.engine,
      }),
    );
    expect(runtimeHarness.createUiAccess).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.createUiAccess).toHaveBeenCalledWith({
      platform: uiPlatform,
      uiOrigin: "chrome-extension://test",
      extensions: [expect.objectContaining({ id: "extension.uiActivation" })],
    });
    expect(runtimeHarness.createProvider).toHaveBeenCalledTimes(1);
    expect(provider).toBe(runtimeHarness.provider);
    expect(firstUiAccess).toBe(uiAccess);
    expect(secondUiAccess).toBe(uiAccess);
    expect(provider.buildSnapshot("eip155")).toEqual(runtimeHarness.providerSnapshot);
    expect(runtimeHarness.provider.buildSnapshot).toHaveBeenCalledWith("eip155");
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
    await runtimeHost.shutdown();

    expect(runtimeHarness.shutdown).toHaveBeenCalledTimes(1);
    await runtimeHost.initializeRuntime();

    expect(createArxWalletRuntimeMock).toHaveBeenCalledTimes(2);
    expect(nextRuntimeHarness.shutdown).not.toHaveBeenCalled();
  });

  it("rejects repeated UI access requests with different parameters", async () => {
    const runtimeHarness = makeRuntime();
    createArxWalletRuntimeMock.mockResolvedValue(runtimeHarness.runtime);
    const uiAccess = {
      buildSnapshotEvent: vi.fn(),
      dispatchRequest: vi.fn(),
      getRequestBroadcastPolicy: vi.fn(),
      subscribeStateChanged: vi.fn(() => vi.fn()),
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
        },
        uiOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    expect(runtimeHarness.createUiAccess).toHaveBeenCalledTimes(1);
  });
});
