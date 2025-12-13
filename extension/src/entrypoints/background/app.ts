import type { JsonRpcId, JsonRpcVersion2 } from "@arx/provider-core/types";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
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
      broadcastHandshakeAck: (snapshot) => portRouter?.broadcastHandshakeAck(snapshot),
      broadcastDisconnect: () => portRouter?.broadcastDisconnect(),
      syncAllPortContexts: (snapshot) => portRouter?.syncAllPortContexts(snapshot),
    },
  });

  portRouter = createPortRouter({
    extensionOrigin,
    connections,
    pendingRequests,
    portContexts,
    ensureContext: serviceManager.ensureContext,
    getControllerSnapshot: serviceManager.getControllerSnapshot,
    attachUiPort: serviceManager.attachUiPort,
    getActiveProviderErrors: serviceManager.getActiveProviderErrors,
    getActiveRpcErrors: serviceManager.getActiveRpcErrors,
  });

  const runtimeMessageProxy = createRuntimeMessageProxy({
    ensureContext: serviceManager.ensureContext,
    persistVaultMeta: serviceManager.persistVaultMeta,
    runtimeId: browser.runtime.id,
  });

  const start = () => {
    void serviceManager.ensureContext();
    browser.runtime.onConnect.addListener(portRouter.handleConnect);
    browser.runtime.onMessage.addListener(runtimeMessageProxy);
  };

  const stop = () => {
    browser.runtime.onConnect.removeListener(portRouter.handleConnect);
    browser.runtime.onMessage.removeListener(runtimeMessageProxy);
    portRouter.destroy();
    serviceManager.destroy();
  };

  return { start, stop };
};
