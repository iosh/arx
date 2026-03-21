import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createApprovalUiListenerMock,
  createBackgroundRuntimeHostMock,
  createPortRouterMock,
  createProviderEventsListenerMock,
  createUiPlatformMock,
  getExtensionOriginMock,
} = vi.hoisted(() => ({
  createApprovalUiListenerMock: vi.fn(),
  createBackgroundRuntimeHostMock: vi.fn(),
  createPortRouterMock: vi.fn(),
  createProviderEventsListenerMock: vi.fn(),
  createUiPlatformMock: vi.fn(),
  getExtensionOriginMock: vi.fn(),
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

vi.mock("./portRouter", () => ({
  createPortRouter: createPortRouterMock,
}));

vi.mock("./listeners/providerEventsListener", () => ({
  createProviderEventsListener: createProviderEventsListenerMock,
}));

vi.mock("./listeners/approvalUiListener", () => ({
  createApprovalUiListener: createApprovalUiListenerMock,
}));

vi.mock("./uiBridge", () => ({
  createUiBridge: vi.fn(),
}));

vi.mock("@arx/core/logger", () => ({
  createLogger: () => vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      getURL: vi.fn(() => "chrome-extension://test/"),
      onConnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}));

describe("background app", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getExtensionOriginMock.mockReturnValue("chrome-extension://test");
    createBackgroundRuntimeHostMock.mockReturnValue({
      applyDebugNamespacesFromEnv: vi.fn(),
      destroy: vi.fn(),
      getOrInitApprovalPopupAccess: vi.fn(),
      getOrInitProviderAccess: vi.fn(),
      getOrInitUiAccess: vi.fn(),
      initializeRuntime: vi.fn(async () => {}),
    });
    createUiPlatformMock.mockReturnValue({
      openNotificationPopup: vi.fn(async () => ({ activationPath: "create" as const })),
      openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
      teardown: vi.fn(),
    });
    createPortRouterMock.mockReturnValue({
      destroy: vi.fn(),
      handleConnect: vi.fn(),
    });
    createProviderEventsListenerMock.mockReturnValue({
      destroy: vi.fn(),
      start: vi.fn(),
    });
    createApprovalUiListenerMock.mockReturnValue({
      destroy: vi.fn(),
      start: vi.fn(),
    });
  });

  it("creates the background runtime host with the extension origin", async () => {
    const { createBackgroundApp } = await import("./app");

    createBackgroundApp();

    expect(createBackgroundRuntimeHostMock).toHaveBeenCalledWith({
      extensionOrigin: "chrome-extension://test",
    });
  });
});
