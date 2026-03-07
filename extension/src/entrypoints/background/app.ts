import { ATTENTION_STATE_CHANGED } from "@arx/core";
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
  const extensionOrigin = getExtensionOrigin();
  const runtimeHost = createBackgroundRuntimeHost({ extensionOrigin });
  const uiPlatform = createUiPlatform({ browser, entrypoints: ENTRYPOINTS });

  const portRouter = createPortRouter({
    extensionOrigin,
    getOrInitContext: runtimeHost.getOrInitContext,
    getControllerSnapshot: runtimeHost.getControllerSnapshot,
  });

  const providerEvents = createProviderEventsListener({ runtimeHost, portRouter });
  const approvalUi = createApprovalUiListener({ runtimeHost, platform: uiPlatform });

  let stopped = false;
  let uiBridge: ReturnType<typeof createUiBridge> | null = null;
  let uiBridgePromise: Promise<ReturnType<typeof createUiBridge>> | null = null;
  let uiBridgeListenersAttached = false;
  let unsubscribeAttentionStateChanged: (() => void) | null = null;

  const getOrInitUiBridge = async () => {
    if (stopped) throw new Error("Background app is stopped");
    if (uiBridge) return uiBridge;
    if (uiBridgePromise) return await uiBridgePromise;

    uiBridgePromise = (async () => {
      const ctx = await runtimeHost.getOrInitContext();
      if (stopped) throw new Error("Background app is stopped");
      const bridge = createUiBridge({
        browser,
        controllers: ctx.controllers,
        chainViews: ctx.chainViews,
        session: ctx.session,
        rpcClients: ctx.runtime.rpc.clients,
        rpcRegistry: ctx.runtime.rpc.registry,
        persistVaultMeta: () => runtimeHost.persistVaultMeta(),
        keyring: ctx.keyring,
        attention: ctx.attention,
        platform: uiPlatform,
      });

      uiBridge = bridge;
      if (!uiBridgeListenersAttached) {
        uiBridgeListenersAttached = true;
        bridge.attachListeners();
      }

      unsubscribeAttentionStateChanged ??= ctx.runtime.bus.subscribe(ATTENTION_STATE_CHANGED, () => {
        uiBridge?.broadcast();
      });

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
      console.warn("[bg] failed to open onboarding tab on install", error);
    });
  };
  const handleConnect = (port: Runtime.Port) => {
    if (port.name === UI_CHANNEL) {
      void attachUiPort(port).catch((error) => {
        console.warn("[bg] failed to attach UI port", error);
      });
      return;
    }
    portRouter.handleConnect(port);
  };

  const start = () => {
    stopped = false;
    runtimeHost.applyDebugNamespacesFromEnv();
    void runtimeHost.getOrInitContext();
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
    unsubscribeAttentionStateChanged?.();
    unsubscribeAttentionStateChanged = null;
    uiBridge?.teardown();
    uiBridge = null;
    uiBridgeListenersAttached = false;
    runtimeHost.destroy();
    uiPlatform.teardown();
  };

  return { start, stop };
};
