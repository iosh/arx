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
  shutdown(): Promise<void>;
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
  let shutdownPromise: Promise<void> | null = null;
  let uiBridge: ReturnType<typeof createUiBridge> | null = null;
  let uiBridgePromise: Promise<ReturnType<typeof createUiBridge>> | null = null;
  let listenersAttached = false;
  let lifecycleGeneration = 0;
  let closed = false;

  const assertOpen = () => {
    if (closed) {
      throw new Error("Background root is shut down");
    }
  };

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
    assertOpen();
    if (uiBridge) {
      return uiBridge;
    }
    if (uiBridgePromise) {
      return await uiBridgePromise;
    }

    const bridgeGeneration = lifecycleGeneration;

    uiBridgePromise = (async () => {
      const uiAccess = await runtimeHost.getOrInitUiAccess({
        platform: uiPlatform,
        activation: uiEntries,
        uiOrigin,
      });

      if (closed || bridgeGeneration !== lifecycleGeneration || shutdownPromise) {
        throw new Error("Background root is shutting down");
      }

      const bridge = createUiBridge({ uiAccess });
      if (closed || bridgeGeneration !== lifecycleGeneration || shutdownPromise) {
        bridge.teardown();
        throw new Error("Background root is shutting down");
      }

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
    if (closed) {
      return;
    }

    if (port.name === UI_CHANNEL) {
      void attachUiPort(port).catch((error) => {
        rootLog("failed to attach UI port", error);
      });
      return;
    }

    providerPortServer.handleConnect(port);
  };

  const cleanupOwnedComponents = async () => {
    lifecycleGeneration += 1;
    detachBrowserListeners();
    uiEntries.destroy();
    providerPortServer.destroy();

    const activeUiBridge = uiBridge;
    const pendingUiBridgePromise = uiBridgePromise;
    uiBridge = null;
    uiBridgePromise = null;

    activeUiBridge?.teardown();
    await runtimeHost.shutdown();

    if (pendingUiBridgePromise) {
      try {
        const pendingUiBridge = await pendingUiBridgePromise;
        pendingUiBridge.teardown();
      } catch {
        // The pending bridge creation already failed or was interrupted by shutdown.
      }
    }

    uiPlatform.teardown();
    initialized = false;
  };

  const initialize = async () => {
    assertOpen();
    if (initialized) {
      return;
    }
    if (initializePromise) {
      return await initializePromise;
    }

    initializePromise = (async () => {
      runtimeHost.applyDebugNamespacesFromEnv();
      attachBrowserListeners();

      const runtimeBootPromise = runtimeHost.initializeRuntime();
      providerPortServer.start();
      uiEntries.start();
      const uiBridgeWarmupPromise = getOrInitUiBridge();

      try {
        await Promise.all([runtimeBootPromise, uiBridgeWarmupPromise]);
        assertOpen();
        initialized = true;
      } catch (error) {
        if (shutdownPromise) {
          await shutdownPromise;
          throw new Error("Background root is shut down");
        }

        await cleanupOwnedComponents();
        throw error;
      } finally {
        initializePromise = null;
      }
    })();

    return await initializePromise;
  };

  const shutdown = async () => {
    if (shutdownPromise) {
      return await shutdownPromise;
    }

    closed = true;
    shutdownPromise = cleanupOwnedComponents();
    return await shutdownPromise;
  };

  return {
    initialize,
    shutdown,
  };
};
