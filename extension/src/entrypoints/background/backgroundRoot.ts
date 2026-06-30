import { createLogger } from "@arx/core/logger";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
import { UI_CHANNEL } from "@/lib/host";
import { ENTRYPOINTS } from "./constants";
import { getExtensionOrigin } from "./origin";
import { createUiPlatform } from "./platform/uiPlatform";
import { createProviderPortServer } from "./providerPortServer";
import { createBackgroundRuntimeHost } from "./runtimeHost";
import { createUiEntryCoordinator } from "./ui/uiEntryCoordinator";
import { createBackgroundUiPort } from "./uiPort";

export type BackgroundRoot = {
  initialize(): Promise<void>;
};

export const createBackgroundRoot = (): BackgroundRoot => {
  const rootLog = createLogger("bg:root");
  const extensionOrigin = getExtensionOrigin();
  const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin });
  const uiPlatform = createUiPlatform({ browser, entrypoints: ENTRYPOINTS });
  const providerPortServer = createProviderPortServer({
    extensionOrigin,
    getOrInitProvider: runtimeHost.getOrInitProvider,
  });
  const uiPort = createBackgroundUiPort({
    runtimeHost,
    host: {
      getEntryLaunchContext: (params) => uiEntries.getEntryLaunchContext(params),
      getEntryBootstrap: (params) => uiEntries.getEntryBootstrap(params),
      openOnboardingTab: (reason) => uiEntries.openOnboardingTab(reason),
    },
  });
  const uiEntries = createUiEntryCoordinator({
    runtimeHost,
    platform: uiPlatform,
    onEntryChanged: (entry) => {
      uiPort.broadcastEntryChanged(entry);
    },
  });

  let initialized = false;
  let initializePromise: Promise<void> | null = null;
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
      uiPort.attachPort(port);
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
        await uiPort.start();
        await uiEntries.start();
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
