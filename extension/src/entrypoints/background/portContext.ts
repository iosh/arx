import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import type { PortContext, ProviderBridgeSnapshot } from "./types";

export type PortContextStore = {
  readPortContext: (port: Runtime.Port) => PortContext | undefined;
  writePortContext: (port: Runtime.Port, context: PortContext) => void;
};

export const syncPortContext = (
  port: Runtime.Port,
  snapshot: ProviderBridgeSnapshot,
  portContextStore: PortContextStore,
  extensionOrigin: string,
) => {
  const existing = portContextStore.readPortContext(port);
  const resolvedOrigin = getPortOrigin(port, extensionOrigin);
  const origin = existing?.origin && existing.origin !== "unknown://" ? existing.origin : resolvedOrigin;

  portContextStore.writePortContext(port, {
    origin,
    providerNamespace: snapshot.namespace,
  });
};

export const syncAllPortContexts = (
  connections: Iterable<Runtime.Port>,
  snapshotByPort: (port: Runtime.Port) => ProviderBridgeSnapshot | null,
  portContextStore: PortContextStore,
  extensionOrigin: string,
) => {
  for (const port of connections) {
    const snapshot = snapshotByPort(port);
    if (!snapshot) continue;
    syncPortContext(port, snapshot, portContextStore, extensionOrigin);
  }
};
