import type { JsonRpcId, JsonRpcVersion2 } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
import { ENTRYPOINTS } from "./constants";
import { getExtensionOrigin } from "./origin";
import { createPortRouter } from "./portRouter";
import { createRuntimeMessageProxy } from "./runtimeMessages";
import { createServiceManager } from "./serviceManager";
import type { PortContext } from "./types";

export const createBackgroundApp = () => {
  const extensionOrigin = getExtensionOrigin();

  const connections = new Set<Runtime.Port>();
  const pendingRequests = new Map<Runtime.Port, Map<string, { rpcId: JsonRpcId; jsonrpc: JsonRpcVersion2 }>>();
  const portContexts = new Map<Runtime.Port, PortContext>();

  let portRouter: ReturnType<typeof createPortRouter> | null = null;

  const serviceManager = createServiceManager({
    extensionOrigin,
    callbacks: {
      broadcastEvent: (event, params) => portRouter?.broadcastEvent(event, params),
      broadcastDisconnect: () => portRouter?.broadcastDisconnect(),
      syncAllPortContexts: (snapshot) => portRouter?.syncAllPortContexts(snapshot),
    },
  });

  portRouter = createPortRouter({
    extensionOrigin,
    connections,
    pendingRequests,
    portContexts,
    getOrInitContext: serviceManager.getOrInitContext,
    getControllerSnapshot: serviceManager.getControllerSnapshot,
    attachUiPort: serviceManager.attachUiPort,
  });

  const runtimeMessageProxy = createRuntimeMessageProxy({
    getOrInitContext: serviceManager.getOrInitContext,
    persistVaultMeta: serviceManager.persistVaultMeta,
    runtimeId: browser.runtime.id,
  });

  const openOrFocusOnboardingTab = async (): Promise<void> => {
    const onboardingBaseUrl = browser.runtime.getURL(ENTRYPOINTS.ONBOARDING);

    const tabs = await browser.tabs.query({ url: [`${onboardingBaseUrl}*`] });
    const existing = (tabs ?? []).find((tab) => typeof tab.id === "number");

    if (existing?.id) {
      await browser.tabs.update(existing.id, { active: true });
      if (typeof existing.windowId === "number") {
        await browser.windows.update(existing.windowId, { focused: true });
      }
      return;
    }

    const created = await browser.tabs.create({ url: onboardingBaseUrl, active: true });
    if (typeof created.windowId === "number") {
      await browser.windows.update(created.windowId, { focused: true });
    }
  };

  const handleOnInstalled = (details: Runtime.OnInstalledDetailsType) => {
    if (details.reason !== "install") return;
    void openOrFocusOnboardingTab().catch((error) => {
      console.warn("[bg] failed to open onboarding tab on install", error);
    });
  };

  const start = () => {
    void serviceManager.getOrInitContext();
    browser.runtime.onConnect.addListener(portRouter.handleConnect);
    browser.runtime.onMessage.addListener(runtimeMessageProxy);
    browser.runtime.onInstalled.addListener(handleOnInstalled);
  };

  const stop = () => {
    browser.runtime.onConnect.removeListener(portRouter.handleConnect);
    browser.runtime.onMessage.removeListener(runtimeMessageProxy);
    browser.runtime.onInstalled.removeListener(handleOnInstalled);
    portRouter.destroy();
    serviceManager.destroy();
  };

  return { start, stop };
};
