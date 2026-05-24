import { UI_CHANNEL } from "@arx/core/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";

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

const createUiAccess = () => ({
  buildSnapshotEvent: vi.fn(),
  dispatchRequest: vi.fn(),
  getRequestBroadcastPolicy: vi.fn(),
  subscribeStateChanged: vi.fn(() => vi.fn()),
  subscribeUiEvents: vi.fn(() => vi.fn()),
});

const createUiEntryAccess = () => ({
  subscribeApprovalCreated: vi.fn(() => vi.fn()),
  subscribeApprovalFinished: vi.fn(() => vi.fn()),
  subscribeApprovalStateChanged: vi.fn(() => vi.fn()),
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
      teardown: vi.fn(),
    });
    createProviderPortServerMock.mockImplementation(() => ({
      start: vi.fn(),
      handleConnect: vi.fn(),
    }));
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
      getEntryBootstrap: vi.fn(async ({ environment }: { environment: "popup" | "notification" | "onboarding" }) => ({
        entry: {
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
        },
        requestedApproval: null,
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
      getOrInitUiEntryAccess: vi.fn(async () => createUiEntryAccess()),
      getOrInitUiAccess: vi.fn(async () => {
        events.push("uiAccess");
        return createUiAccess();
      }),
    });

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await root.initialize();
    await root.initialize();

    const runtimeHost = createBackgroundRuntimeHostMock.mock.results[0]?.value;
    expect(runtimeHost.initializeRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeHost.getOrInitUiAccess).toHaveBeenCalledTimes(0);
    expect(createUiBridgeMock).toHaveBeenCalledTimes(0);
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
      getOrInitUiEntryAccess: vi.fn(async () => createUiEntryAccess()),
    };
    createBackgroundRuntimeHostMock.mockReturnValue(runtimeHost);

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await expect(root.initialize()).rejects.toThrow();
    await root.initialize();

    expect(createProviderPortServerMock).toHaveBeenCalledTimes(1);
    expect(createProviderPortServerMock.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
    expect(createUiEntryCoordinatorMock.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
    expect(onConnectRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(onInstalledRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(runtimeHost.initializeRuntime).toHaveBeenCalledTimes(2);
    expect(createUiBridgeMock).toHaveBeenCalledTimes(0);
  });

  it("lazily creates the UI bridge on first UI port connect and retries after failure", async () => {
    const runtimeHost = {
      applyDebugNamespacesFromEnv: vi.fn(),
      initializeRuntime: vi.fn(async () => {}),
      getOrInitProvider: vi.fn(),
      getOrInitUiEntryAccess: vi.fn(async () => createUiEntryAccess()),
      getOrInitUiAccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("ui access failed"))
        .mockResolvedValueOnce(createUiAccess()),
    };
    createBackgroundRuntimeHostMock.mockReturnValue(runtimeHost);

    const bridge = {
      attachPort: vi.fn(),
      broadcastEvent: vi.fn(),
      teardown: vi.fn(),
    };
    createUiBridgeMock.mockReturnValue(bridge);

    const { createBackgroundRoot } = await import("./backgroundRoot");
    const root = createBackgroundRoot();

    await root.initialize();
    expect(runtimeHost.getOrInitUiAccess).toHaveBeenCalledTimes(0);

    const readOnConnectListener = () => {
      const listener = onConnectAddListenerMock.mock.calls.at(-1)?.[0] as ((port: Runtime.Port) => void) | undefined;
      if (!listener) {
        throw new Error("onConnect listener was not registered");
      }
      return listener;
    };

    const firstUiPort = { name: UI_CHANNEL } as unknown as Runtime.Port;
    readOnConnectListener()(firstUiPort);

    await vi.waitFor(() => expect(runtimeHost.getOrInitUiAccess).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(createUiBridgeMock).toHaveBeenCalledTimes(0);
    expect(bridge.attachPort).not.toHaveBeenCalled();

    const secondUiPort = { name: UI_CHANNEL } as unknown as Runtime.Port;
    readOnConnectListener()(secondUiPort);

    await vi.waitFor(() => expect(runtimeHost.getOrInitUiAccess).toHaveBeenCalledTimes(2));
    expect(createUiBridgeMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(bridge.attachPort).toHaveBeenCalledTimes(1));
    expect(bridge.attachPort).toHaveBeenCalledWith(secondUiPort);
  });
});
