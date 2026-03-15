import type { BackgroundRuntime } from "@arx/core/runtime";
import { ATTENTION_REQUESTED, ATTENTION_STATE_CHANGED } from "@arx/core/services";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRuntimeHost } from "./runtimeHost";

const { createBackgroundRuntimeMock, getExtensionStorageMock, disableDebugNamespacesMock, enableDebugNamespacesMock } =
  vi.hoisted(() => ({
    createBackgroundRuntimeMock: vi.fn(),
    getExtensionStorageMock: vi.fn(),
    disableDebugNamespacesMock: vi.fn(),
    enableDebugNamespacesMock: vi.fn(),
  }));

vi.mock("@arx/core/runtime", () => ({
  createBackgroundRuntime: createBackgroundRuntimeMock,
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
  const persistVaultMeta = vi.fn(async () => {});
  const unsubscribeAttentionStateChanged = vi.fn();
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
  const subscribe = vi.fn(() => unsubscribeAttentionStateChanged);

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
        persistVaultMeta,
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
  } as unknown as BackgroundRuntime;

  return {
    runtime,
    initialize,
    start,
    destroy,
    persistVaultMeta,
    subscribe,
    unsubscribeAttentionStateChanged,
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

    const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin: "chrome-extension://test" });

    await runtimeHost.initializeRuntime();
    const firstUiBridgeAccess = await runtimeHost.getOrInitUiBridgeAccess();
    const secondUiBridgeAccess = await runtimeHost.getOrInitUiBridgeAccess();
    const providerEventsAccess = await runtimeHost.getOrInitProviderEventsAccess();
    const approvalUiAccess = await runtimeHost.getOrInitApprovalUiAccess();

    expect(createBackgroundRuntimeMock).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.initialize).toHaveBeenCalledTimes(1);
    expect(runtimeHarness.start).toHaveBeenCalledTimes(1);
    expect(firstUiBridgeAccess.uiBridgeRuntimeInputs.controllers).toBe(runtimeHarness.runtime.controllers);
    expect(secondUiBridgeAccess.uiBridgeRuntimeInputs.rpcRegistry).toBe(runtimeHarness.runtime.rpc.registry);
    expect(providerEventsAccess.getActiveChainByNamespace()).toEqual({ eip155: "eip155:1" });
    expect(approvalUiAccess.hasInitializedVault()).toBe(true);

    await firstUiBridgeAccess.uiBridgeRuntimeInputs.persistVaultMeta();
    expect(runtimeHarness.persistVaultMeta).toHaveBeenCalledTimes(1);

    const listener = vi.fn();
    const unsubscribe = firstUiBridgeAccess.subscribeAttentionStateChanged(listener);
    expect(runtimeHarness.subscribe).toHaveBeenCalledWith(ATTENTION_STATE_CHANGED, expect.any(Function));
    expect(unsubscribe).toBe(runtimeHarness.unsubscribeAttentionStateChanged);

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
    await expect(runtimeHost.getOrInitUiBridgeAccess()).rejects.toThrow("Background runtime host is destroyed");
    await expect(runtimeHost.getOrInitProviderEventsAccess()).rejects.toThrow("Background runtime host is destroyed");
    await expect(runtimeHost.getOrInitApprovalUiAccess()).rejects.toThrow("Background runtime host is destroyed");
  });
});
