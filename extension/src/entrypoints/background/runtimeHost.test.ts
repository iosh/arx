import type { BackgroundRuntime } from "@arx/core/runtime";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const {
  createBackgroundRuntimeMock,
  createUiRuntimeAccessMock,
  getExtensionStorageMock,
  disableDebugNamespacesMock,
  enableDebugNamespacesMock,
} = vi.hoisted(() => ({
  createBackgroundRuntimeMock: vi.fn(),
  createUiRuntimeAccessMock: vi.fn(),
  getExtensionStorageMock: vi.fn(),
  disableDebugNamespacesMock: vi.fn(),
  enableDebugNamespacesMock: vi.fn(),
}));

vi.mock("@arx/core/runtime", () => ({
  createBackgroundRuntime: createBackgroundRuntimeMock,
}));

vi.mock("@arx/core/ui/server", () => ({
  createUiRuntimeAccess: createUiRuntimeAccessMock,
}));

vi.mock("@/platform/storage", () => ({
  getExtensionStorage: getExtensionStorageMock,
}));

vi.mock("@/platform/namespaces/installed", () => ({
  INSTALLED_NAMESPACE_MANIFESTS: [],
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
  const destroy = vi.fn();
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
        getProviderChainView: vi.fn(() => ({
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
      namespaceBindings: {},
      keyring: {},
    },
    rpc: {
      engine: {},
      registry: {},
      getActiveNamespace: vi.fn(),
    },
    lifecycle: {
      initialize,
      start,
      destroy,
      getIsInitialized: vi.fn(),
    },
    providerAccess,
  } as unknown as BackgroundRuntime;

  return {
    runtime,
    providerAccess,
    providerSnapshot,
    initialize,
    start,
    destroy,
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
      shouldHoldBroadcast: vi.fn(),
      subscribeStateChanged: vi.fn(() => vi.fn()),
    };
    createUiRuntimeAccessMock.mockReturnValue(uiAccess);

    const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin: "chrome-extension://test" });
    const uiPlatform = {
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
    };

    await runtimeHost.initializeRuntime();
    const providerAccess = await runtimeHost.getOrInitProviderAccess();
    const firstUiAccess = await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      uiOrigin: "chrome-extension://test",
    });
    const secondUiAccess = await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      uiOrigin: "chrome-extension://test",
    });
    const approvalUiAccess = await runtimeHost.getOrInitApprovalUiAccess();

    expect(createBackgroundRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createUiRuntimeAccessMock).toHaveBeenCalledTimes(1);
    expect(createUiRuntimeAccessMock).toHaveBeenCalledWith({
      runtime: runtimeHarness.runtime,
      platform: uiPlatform,
      uiOrigin: "chrome-extension://test",
    });
    expect(runtimeHarness.initialize).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.start).toHaveBeenCalledTimes(1);
    expect(providerAccess).toBe(runtimeHarness.providerAccess);
    expect(firstUiAccess).toBe(uiAccess);
    expect(secondUiAccess).toBe(uiAccess);
    expect(providerAccess.getActiveChainByNamespace()).toEqual({ eip155: "eip155:1" });
    expect(providerAccess.buildSnapshot("eip155")).toEqual(runtimeHarness.providerSnapshot);
    expect(runtimeHarness.providerAccess.buildSnapshot).toHaveBeenCalledWith("eip155");
    expect(approvalUiAccess.hasInitializedVault()).toBe(true);

    const approvalListener = vi.fn();
    approvalUiAccess.subscribeAttentionRequested(approvalListener);
    expect(runtimeHarness.subscribe).toHaveBeenCalledWith(ATTENTION_REQUESTED, approvalListener);
  });

  it("destroys runtime and rejects new access after destroy", async () => {
    const runtimeHarness = makeRuntime();
    createBackgroundRuntimeMock.mockReturnValue(runtimeHarness.runtime);

    const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin: "chrome-extension://test" });

    await runtimeHost.initializeRuntime();
    runtimeHost.destroy();

    expect(runtimeHarness.destroy).toHaveBeenCalledTimes(1);
    await expect(runtimeHost.initializeRuntime()).rejects.toThrow("Background runtime host is destroyed");
    await expect(runtimeHost.getOrInitProviderAccess()).rejects.toThrow("Background runtime host is destroyed");
    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: {
          openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
          openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
        },
        uiOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("Background runtime host is destroyed");
    await expect(runtimeHost.getOrInitApprovalUiAccess()).rejects.toThrow("Background runtime host is destroyed");
  });

  it("rejects repeated UI access requests with different parameters", async () => {
    const runtimeHarness = makeRuntime();
    createBackgroundRuntimeMock.mockReturnValue(runtimeHarness.runtime);
    const uiAccess = {
      buildSnapshotEvent: vi.fn(),
      dispatchRequest: vi.fn(),
      shouldHoldBroadcast: vi.fn(),
      subscribeStateChanged: vi.fn(() => vi.fn()),
    };
    createUiRuntimeAccessMock.mockReturnValue(uiAccess);

    const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin: "chrome-extension://test" });
    const uiPlatform = {
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
    };

    await runtimeHost.getOrInitUiAccess({
      platform: uiPlatform,
      uiOrigin: "chrome-extension://test",
    });

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        uiOrigin: "chrome-extension://different",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    await expect(
      runtimeHost.getOrInitUiAccess({
        platform: {
          openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
          openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
        },
        uiOrigin: "chrome-extension://test",
      }),
    ).rejects.toThrow("UI access parameters must remain stable");

    expect(createUiRuntimeAccessMock).toHaveBeenCalledTimes(1);
  });
});
