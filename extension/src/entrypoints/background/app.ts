import { createLogger } from "@arx/core/logger";
import { UI_CHANNEL } from "@arx/core/ui";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
import { ENTRYPOINTS } from "./constants";
import { createApprovalUiListener } from "./listeners/approvalUiListener";
import { createProviderEventsListener } from "./listeners/providerEventsListener";
import { getExtensionOrigin } from "./origin";
import { createUiPlatform } from "./platform/uiPlatform";
import { createPortRouter } from "./portRouter";
import { createBackgroundRuntimeHost } from "./runtimeHost";
import { createUiBridge } from "./uiBridge";

export const createBackgroundApp = () => {
  const appLog = createLogger("bg:app");
  const extensionOrigin = getExtensionOrigin();
  const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin });
  const uiPlatform = createUiPlatform({ browser, entrypoints: ENTRYPOINTS });

  const portRouter = createPortRouter({
    extensionOrigin,
    getOrInitProviderAccess: runtimeHost.getOrInitProviderAccess,
  });

  const providerEvents = createProviderEventsListener({ runtimeHost, portRouter });
  const approvalUi = createApprovalUiListener({ runtimeHost, platform: uiPlatform });

  let stopped = false;
  let uiBridge: ReturnType<typeof createUiBridge> | null = null;
  let uiBridgePromise: Promise<ReturnType<typeof createUiBridge>> | null = null;

  const getOrInitUiBridge = async () => {
    if (stopped) throw new Error("Background app is stopped");
    if (uiBridge) return uiBridge;
    if (uiBridgePromise) return await uiBridgePromise;

    uiBridgePromise = (async () => {
      const uiAccess = await runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        uiOrigin: new URL(browser.runtime.getURL("")).origin,
      });
      if (stopped) throw new Error("Background app is stopped");
      const bridge = createUiBridge({ uiAccess });

      uiBridge = bridge;
      return bridge;
    })().finally(() => {
      uiBridgePromise = null;
    });

    return await uiBridgePromise;
  };

  const attachUiPort = async (port: Runtime.Port) => {
    const bridge = await getOrInitUiBridge();
    bridge.attachPort(port as unknown as Parameters<typeof bridge.attachPort>[0]);
  };

  const openOrFocusOnboardingTab = async (): Promise<void> => {
    await uiPlatform.openOnboardingTab("install");
  };

  const handleOnInstalled = (details: Runtime.OnInstalledDetailsType) => {
    if (details.reason !== "install") return;
    void openOrFocusOnboardingTab().catch((error) => {
      appLog("failed to open onboarding tab on install", error);
    });
  };
  const handleConnect = (port: Runtime.Port) => {
    if (port.name === UI_CHANNEL) {
      void attachUiPort(port).catch((error) => {
        appLog("failed to attach UI port", error);
      });
      return;
    }
    portRouter.handleConnect(port);
  };

  const start = () => {
    stopped = false;
    runtimeHost.applyDebugNamespacesFromEnv();
    void runtimeHost.initializeRuntime();
    providerEvents.start();
    approvalUi.start();

    browser.runtime.onConnect.addListener(handleConnect);
    browser.runtime.onInstalled.addListener(handleOnInstalled);
  };

  const stop = () => {
    stopped = true;
    browser.runtime.onInstalled.removeListener(handleOnInstalled);
    browser.runtime.onConnect.removeListener(handleConnect);
    providerEvents.destroy();
    approvalUi.destroy();
    portRouter.destroy();
    uiBridge?.teardown();
    uiBridge = null;
    runtimeHost.destroy();
    uiPlatform.teardown();
  };

  return { start, stop };
};
