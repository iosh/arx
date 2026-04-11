import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createUiEntryCoordinatorMock,
  createBackgroundRuntimeHostMock,
  createProviderPortServerMock,
  createUiBridgeMock,
  createUiPlatformMock,
  getExtensionOriginMock,
  onConnectAddListenerMock,
  onConnectRemoveListenerMock,
  onInstalledAddListenerMock,
  onInstalledRemoveListenerMock,
} = vi.hoisted(() => ({
  createUiEntryCoordinatorMock: vi.fn(),
  createBackgroundRuntimeHostMock: vi.fn(),
  createProviderPortServerMock: vi.fn(),
  createUiBridgeMock: vi.fn(),
  createUiPlatformMock: vi.fn(),
  getExtensionOriginMock: vi.fn(),
  onConnectAddListenerMock: vi.fn(),
  onConnectRemoveListenerMock: vi.fn(),
  onInstalledAddListenerMock: vi.fn(),
  onInstalledRemoveListenerMock: vi.fn(),
}));

vi.mock("./runtimeHost", () => ({
  createBackgroundRuntimeHost: createBackgroundRuntimeHostMock,
}));

vi.mock("./origin", () => ({
  getExtensionOrigin: getExtensionOriginMock,
}));

vi.mock("./platform/uiPlatform", () => ({
  createUiPlatform: createUiPlatformMock,
}));

vi.mock("./providerPortServer", () => ({
  createProviderPortServer: createProviderPortServerMock,
}));

vi.mock("./ui/uiEntryCoordinator", () => ({
  createUiEntryCoordinator: createUiEntryCoordinatorMock,
}));

vi.mock("./uiBridge", () => ({
  createUiBridge: createUiBridgeMock,
  UI_CHANNEL: "ui:channel",
}));

vi.mock("@arx/core/logger", () => ({
  createLogger: () => vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      getURL: vi.fn(() => "chrome-extension://test/"),
      onConnect: {
        addListener: onConnectAddListenerMock,
        removeListener: onConnectRemoveListenerMock,
      },
      onInstalled: {
        addListener: onInstalledAddListenerMock,
        removeListener: onInstalledRemoveListenerMock,
      },
    },
  },
}));

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
};

describe("backgroundRoot", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getExtensionOriginMock.mockReturnValue("chrome-extension://test");
    createUiPlatformMock.mockReturnValue({
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      trackWindowClose: vi.fn(),
      clearWindowCloseTracks: vi.fn(),
      teardown: vi.fn(),
    });
    createProviderPortServerMock.mockReturnValue({
      destroy: vi.fn(),
      start: vi.fn(),
      handleConnect: vi.fn(),
    });
    createUiEntryCoordinatorMock.mockReturnValue({
      getEntryLaunchContext: vi.fn(({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
        environment,
        reason:
          environment === "onboarding"
            ? "onboarding_required"
            : environment === "notification"
              ? "idle"
              : "manual_open",
        context: {
          approvalId: null,
          origin: null,
          method: null,
          chainRef: null,
          namespace: null,
        },
      })),
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      destroy: vi.fn(),
      start: vi.fn(),
    });
    createUiBridgeMock.mockReturnValue({
      attachPort: vi.fn(),
      broadcastEvent: vi.fn(),
      teardown: vi.fn(),
    });
  });

  it("attaches listeners before boot and shares one initialize path", async () => {
    const events: string[] = [];
    onConnectAddListenerMock.mockImplementation(() => {
      events.push("onConnect");
    });
    onInstalledAddListenerMock.mockImplementation(() => {
      events.push("onInstalled");
    });

    createBackgroundRuntimeHostMock.mockReturnValue({
      applyDebugNamespacesFromEnv: vi.fn(),
      initializeRuntime: vi.fn(() => {
        events.push("boot");
        return Promise.resolve();
      }),
      getOrInitProvider: vi.fn(),
      getOrInitUiEntryAccess: vi.fn(),
      getOrInitUiAccess: vi.fn(async () => {
        events.push("uiAccess");
        return {
          buildSnapshotEvent: vi.fn(),
          dispatchRequest: vi.fn(),
          getRequestBroadcastPolicy: vi.fn(),
          subscribeStateChanged: vi.fn(() => vi.fn()),
        };
      }),
      shutdown: vi.fn(async () => {}),
    });

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await root.initialize();
    await root.initialize();

    const runtimeHost = createBackgroundRuntimeHostMock.mock.results[0]?.value;
    expect(runtimeHost.initializeRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeHost.getOrInitUiAccess).toHaveBeenCalledTimes(1);
    expect(createUiBridgeMock).toHaveBeenCalledTimes(1);
    expect(createProviderPortServerMock.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
    expect(createUiEntryCoordinatorMock.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
    expect(events.indexOf("onConnect")).toBeLessThan(events.indexOf("boot"));
    expect(events.indexOf("onInstalled")).toBeLessThan(events.indexOf("boot"));
  });

  it("cleans up after a boot failure and allows retry", async () => {
    const runtimeHost = {
      applyDebugNamespacesFromEnv: vi.fn(),
      initializeRuntime: vi.fn().mockRejectedValueOnce(new Error("boot failed")).mockResolvedValueOnce(undefined),
      getOrInitProvider: vi.fn(),
      getOrInitUiEntryAccess: vi.fn(),
      getOrInitUiAccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("ui access failed"))
        .mockResolvedValueOnce({
          buildSnapshotEvent: vi.fn(),
          dispatchRequest: vi.fn(),
          getRequestBroadcastPolicy: vi.fn(),
          subscribeStateChanged: vi.fn(() => vi.fn()),
        }),
      shutdown: vi.fn(async () => {}),
    };
    createBackgroundRuntimeHostMock.mockReturnValue(runtimeHost);

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await expect(root.initialize()).rejects.toThrow();
    await root.initialize();

    expect(runtimeHost.shutdown).toHaveBeenCalledTimes(1);
    expect(createProviderPortServerMock.mock.results[0]?.value.destroy).toHaveBeenCalledTimes(1);
    expect(createUiEntryCoordinatorMock.mock.results[0]?.value.destroy).toHaveBeenCalledTimes(1);
    expect(onConnectRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(onInstalledRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(runtimeHost.initializeRuntime).toHaveBeenCalledTimes(2);
    expect(createUiBridgeMock).toHaveBeenCalledTimes(1);
  });

  it("shuts down cleanly while boot is still in flight", async () => {
    const runtimeBoot = createDeferred<void>();
    const uiAccessBoot = createDeferred<{
      buildSnapshotEvent: ReturnType<typeof vi.fn>;
      dispatchRequest: ReturnType<typeof vi.fn>;
      getRequestBroadcastPolicy: ReturnType<typeof vi.fn>;
      subscribeStateChanged: ReturnType<typeof vi.fn>;
    }>();

    const runtimeHost = {
      applyDebugNamespacesFromEnv: vi.fn(),
      initializeRuntime: vi.fn(() => runtimeBoot.promise),
      getOrInitProvider: vi.fn(),
      getOrInitUiEntryAccess: vi.fn(),
      getOrInitUiAccess: vi.fn(() => uiAccessBoot.promise),
      shutdown: vi.fn(async () => {
        runtimeBoot.reject(new Error("runtime interrupted"));
        uiAccessBoot.reject(new Error("ui interrupted"));
      }),
    };
    createBackgroundRuntimeHostMock.mockReturnValue(runtimeHost);

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    const initializePromise = root.initialize();
    await root.shutdown();

    await expect(initializePromise).rejects.toThrow("Background root is shut down");
    await expect(root.initialize()).rejects.toThrow("Background root is shut down");
    expect(runtimeHost.shutdown).toHaveBeenCalledTimes(1);
    expect(createProviderPortServerMock.mock.results[0]?.value.destroy).toHaveBeenCalledTimes(1);
    expect(createUiEntryCoordinatorMock.mock.results[0]?.value.destroy).toHaveBeenCalledTimes(1);
  });
});
