import { createLogger } from "@arx/core/logger";
import { UI_CHANNEL, UI_EVENT_ENTRY_CHANGED } from "@arx/core/ui";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
import { ENTRYPOINTS } from "./constants";
import { getExtensionOrigin } from "./origin";
import { createUiPlatform } from "./platform/uiPlatform";
import { createProviderPortServer } from "./providerPortServer";
import { createBackgroundRuntimeHost } from "./runtimeHost";
import { createUiEntryCoordinator } from "./ui/uiEntryCoordinator";
import { createUiBridge } from "./uiBridge";

export type BackgroundRoot = {
  initialize(): Promise<void>;
};

export const createBackgroundRoot = (): BackgroundRoot => {
  const rootLog = createLogger("bg:root");
  const extensionOrigin = getExtensionOrigin();
  const uiOrigin = new URL(browser.runtime.getURL("")).origin;
  const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin });
  const uiPlatform = createUiPlatform({ browser, entrypoints: ENTRYPOINTS });
  const providerPortServer = createProviderPortServer({
    extensionOrigin,
    getOrInitProvider: runtimeHost.getOrInitProvider,
  });
  const uiEntries = createUiEntryCoordinator({
    runtimeHost,
    platform: uiPlatform,
    onEntryChanged: (entry) => {
      uiBridge?.broadcastEvent({
        type: "ui:event",
        event: UI_EVENT_ENTRY_CHANGED,
        payload: entry,
      });
    },
  });

  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let uiBridge: ReturnType<typeof createUiBridge> | null = null;
  let uiBridgePromise: Promise<ReturnType<typeof createUiBridge>> | null = null;
  let listenersAttached = false;

  const attachBrowserListeners = () => {
    if (listenersAttached) {
      return;
    }

    browser.runtime.onConnect.addListener(handleConnect);
    browser.runtime.onInstalled.addListener(handleOnInstalled);
    listenersAttached = true;
  };

  const detachBrowserListeners = () => {
    if (!listenersAttached) {
      return;
    }

    browser.runtime.onInstalled.removeListener(handleOnInstalled);
    browser.runtime.onConnect.removeListener(handleConnect);
    listenersAttached = false;
  };

  const getOrInitUiBridge = async () => {
    if (uiBridge) {
      return uiBridge;
    }
    if (uiBridgePromise) {
      return await uiBridgePromise;
    }

    uiBridgePromise = (async () => {
      const uiAccess = await runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        activation: uiEntries,
        uiOrigin,
      });

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

  const handleOnInstalled = (details: Runtime.OnInstalledDetailsType) => {
    if (details.reason !== "install") {
      return;
    }

    void uiEntries.openOnboardingTab("install").catch((error) => {
      rootLog("failed to open onboarding tab on install", error);
    });
  };

  const handleConnect = (port: Runtime.Port) => {
    if (port.name === UI_CHANNEL) {
      void attachUiPort(port).catch((error) => {
        rootLog("failed to attach UI port", error);
      });
      return;
    }

    providerPortServer.handleConnect(port);
  };

  const recoverFailedBoot = () => {
    detachBrowserListeners();
    initialized = false;
  };

  const initialize = async () => {
    if (initialized) {
      return;
    }
    if (initializePromise) {
      return await initializePromise;
    }

    initializePromise = (async () => {
      runtimeHost.applyDebugNamespacesFromEnv();
      attachBrowserListeners();

      try {
        await runtimeHost.initializeRuntime();
        providerPortServer.start();
        uiEntries.start();
        initialized = true;
      } catch (error) {
        recoverFailedBoot();
        throw error;
      } finally {
        initializePromise = null;
      }
    })();

    return await initializePromise;
  };

  return {
    initialize,
  };
};
