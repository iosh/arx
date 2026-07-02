import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { UI_CHANNEL } from "@/lib/host";

const {
  createUiEntryCoordinatorMock,
  createBackgroundRuntimeHostMock,
  createProviderPortServerMock,
  createBackgroundUiPortMock,
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
  createBackgroundUiPortMock: vi.fn(),
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

vi.mock("./uiPort", () => ({
  createBackgroundUiPort: createBackgroundUiPortMock,
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
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

const createUiEntries = () => ({
  getEntryLaunchContext: vi.fn(),
  getEntryBootstrap: vi.fn(),
  openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
  start: vi.fn(async () => {}),
  destroy: vi.fn(),
});

describe("backgroundRoot", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getExtensionOriginMock.mockReturnValue("chrome-extension://test");
    createUiPlatformMock.mockReturnValue({
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      trackWindowClose: vi.fn(),
      clearWindowCloseTracks: vi.fn(),
    });
    createProviderPortServerMock.mockReturnValue({
      start: vi.fn(),
      handleConnect: vi.fn(),
    });
    createUiEntryCoordinatorMock.mockReturnValue(createUiEntries());
    createBackgroundUiPortMock.mockReturnValue({
      start: vi.fn(async () => {}),
      attachPort: vi.fn(),
      broadcastEntryChanged: vi.fn(),
      destroy: vi.fn(),
    });
  });

  it("initializes runtime once and starts the shared UI port", async () => {
    const events: string[] = [];
    onConnectAddListenerMock.mockImplementation(() => {
      events.push("onConnect");
    });
    onInstalledAddListenerMock.mockImplementation(() => {
      events.push("onInstalled");
    });

    createBackgroundRuntimeHostMock.mockReturnValue({
      initializeRuntime: vi.fn(async () => {
        events.push("boot");
      }),
      getOrInitProvider: vi.fn(),
      getOrInitWalletMethodExecutor: vi.fn(),
      subscribeWalletInvalidation: vi.fn(async () => vi.fn()),
      getOrInitUiEntryAccess: vi.fn(),
    });

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await root.initialize();
    await root.initialize();

    const runtimeHost = createBackgroundRuntimeHostMock.mock.results[0]?.value;
    const providerPortServer = createProviderPortServerMock.mock.results[0]?.value;
    const uiEntries = createUiEntryCoordinatorMock.mock.results[0]?.value;
    const uiPort = createBackgroundUiPortMock.mock.results[0]?.value;

    expect(runtimeHost.initializeRuntime).toHaveBeenCalledTimes(1);
    expect(providerPortServer.start).toHaveBeenCalledTimes(1);
    expect(uiPort.start).toHaveBeenCalledTimes(1);
    expect(uiEntries.start).toHaveBeenCalledTimes(1);
    expect(events.indexOf("onConnect")).toBeLessThan(events.indexOf("boot"));
    expect(events.indexOf("onInstalled")).toBeLessThan(events.indexOf("boot"));
  });

  it("routes UI ports through the shared UI port adapter", async () => {
    createBackgroundRuntimeHostMock.mockReturnValue({
      initializeRuntime: vi.fn(async () => {}),
      getOrInitProvider: vi.fn(),
      getOrInitWalletMethodExecutor: vi.fn(),
      subscribeWalletInvalidation: vi.fn(async () => vi.fn()),
      getOrInitUiEntryAccess: vi.fn(),
    });

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await root.initialize();

    const onConnectListener = onConnectAddListenerMock.mock.calls.at(-1)?.[0] as
      | ((port: Runtime.Port) => void)
      | undefined;
    const uiPort = createBackgroundUiPortMock.mock.results[0]?.value;
    if (!onConnectListener) {
      throw new Error("onConnect listener was not registered");
    }

    const port = { name: UI_CHANNEL } as Runtime.Port;
    onConnectListener(port);

    expect(uiPort.attachPort).toHaveBeenCalledWith(port);
  });

  it("detaches browser listeners after a failed boot and allows retry", async () => {
    const runtimeHost = {
      initializeRuntime: vi.fn().mockRejectedValueOnce(new Error("boot failed")).mockResolvedValueOnce(undefined),
      getOrInitProvider: vi.fn(),
      getOrInitWalletMethodExecutor: vi.fn(),
      subscribeWalletInvalidation: vi.fn(async () => vi.fn()),
      getOrInitUiEntryAccess: vi.fn(),
    };
    createBackgroundRuntimeHostMock.mockReturnValue(runtimeHost);

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await expect(root.initialize()).rejects.toThrow("boot failed");
    await root.initialize();

    expect(onConnectRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(onInstalledRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(runtimeHost.initializeRuntime).toHaveBeenCalledTimes(2);
    expect(createBackgroundUiPortMock.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
  });
});
