import type { BackgroundRuntime } from "@arx/core/runtime";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const { createBackgroundRuntimeMock, getExtensionStorageMock, disableDebugNamespacesMock, enableDebugNamespacesMock } =
  vi.hoisted(() => ({
    createBackgroundRuntimeMock: vi.fn(),
    getExtensionStorageMock: vi.fn(),
    disableDebugNamespacesMock: vi.fn(),
    enableDebugNamespacesMock: vi.fn(),
  }));

const { installedNamespaces } = vi.hoisted(() => ({
  installedNamespaces: {
    runtime: {
      manifests: [],
    },
  } as const,
}));

vi.mock("@arx/core/runtime", () => ({
  createBackgroundRuntime: createBackgroundRuntimeMock,
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
  const initialize = vi.fn(async () => {});
  const start = vi.fn();
  const shutdown = vi.fn();
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
  const providerAccess = {
    buildSnapshot: vi.fn(() => providerSnapshot),
    buildConnectionState: vi.fn(async () => ({
      snapshot: providerSnapshot,
      accounts: [],
    })),
    getActiveChainByNamespace: vi.fn(() => ({ eip155: "eip155:1" })),
    subscribeSessionUnlocked: onUnlocked,
    subscribeSessionLocked: onLocked,
    subscribeNetworkStateChanged: onNetworkStateChanged,
    subscribeNetworkPreferencesChanged: subscribeNetworkPreferencesChanged,
    subscribeAccountsStateChanged: onAccountsStateChanged,
    subscribePermissionsStateChanged: onPermissionsStateChanged,
    executeRpcRequest: vi.fn(),
    encodeRpcError: vi.fn(),
    listPermittedAccounts: vi.fn(),
    cancelSessionApprovals: vi.fn(async () => 0),
  };
  const createUiAccess = vi.fn();

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
    lifecycle: {
      initialize,
      start,
      shutdown,
      getIsInitialized: vi.fn(),
    },
    providerAccess,
    createUiAccess,
  } as unknown as BackgroundRuntime;

  return {
    runtime,
    providerAccess,
    createUiAccess,
    providerSnapshot,
    initialize,
    start,
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
    createBackgroundRuntimeMock.mockReturnValue(runtimeHarness.runtime);
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

    await runtimeHost.initializeRuntime();
    const providerAccess = await runtimeHost.getOrInitProviderAccess();
    const firstUiAccess = await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      surfaceOrigin: "chrome-extension://test",
    });
    const secondUiAccess = await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      surfaceOrigin: "chrome-extension://test",
    });
    const approvalPopupAccess = await runtimeHost.getOrInitApprovalPopupAccess();

    expect(createBackgroundRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createBackgroundRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaces: installedNamespaces.runtime,
      }),
    );
    expect(runtimeHarness.createUiAccess).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.createUiAccess).toHaveBeenCalledWith({
      platform: uiPlatform,
      surfaceOrigin: "chrome-extension://test",
    });
    expect(runtimeHarness.initialize).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.start).toHaveBeenCalledTimes(1);
    expect(providerAccess).toBe(runtimeHarness.providerAccess);
    expect(firstUiAccess).toBe(uiAccess);
    expect(secondUiAccess).toBe(uiAccess);
    expect(providerAccess.getActiveChainByNamespace()).toEqual({ eip155: "eip155:1" });
    expect(providerAccess.buildSnapshot("eip155")).toEqual(runtimeHarness.providerSnapshot);
    expect(runtimeHarness.providerAccess.buildSnapshot).toHaveBeenCalledWith("eip155");
    expect(approvalPopupAccess.hasInitializedVault()).toBe(true);

    const unlockListener = vi.fn();
    approvalPopupAccess.subscribeUnlockAttentionRequested(unlockListener);
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

  it("destroys runtime and rejects new access after destroy", async () => {
    const runtimeHarness = makeRuntime();
    createBackgroundRuntimeMock.mockReturnValue(runtimeHarness.runtime);

    const runtimeHost = createBackgroundRuntimeHost({
      extensionOrigin: "chrome-extension://test",
    });

    await runtimeHost.initializeRuntime();
    runtimeHost.destroy();

    expect(runtimeHarness.shutdown).toHaveBeenCalledTimes(1);
    await expect(runtimeHost.initializeRuntime()).rejects.toThrow("Background runtime host is destroyed");
    await expect(runtimeHost.getOrInitProviderAccess()).rejects.toThrow("Background runtime host is destroyed");
    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: {
          openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
          openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
        },
        surfaceOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("Background runtime host is destroyed");
    await expect(runtimeHost.getOrInitApprovalPopupAccess()).rejects.toThrow("Background runtime host is destroyed");
  });

  it("rejects repeated UI access requests with different parameters", async () => {
    const runtimeHarness = makeRuntime();
    createBackgroundRuntimeMock.mockReturnValue(runtimeHarness.runtime);
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

    await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      surfaceOrigin: "chrome-extension://test",
    });

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        surfaceOrigin: "chrome-extension://different",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: {
          openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
          openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
        },
        surfaceOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    expect(runtimeHarness.createUiAccess).toHaveBeenCalledTimes(1);
  });
});
