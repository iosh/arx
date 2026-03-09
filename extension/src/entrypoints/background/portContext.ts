import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import type { PortContext, ProviderBridgeSnapshot } from "./types";

export const syncPortContext = (
  port: Runtime.Port,
  snapshot: ProviderBridgeSnapshot,
  portContexts: Map<Runtime.Port, PortContext>,
  extensionOrigin: string,
) => {
  const existing = portContexts.get(port);
  const resolvedOrigin = getPortOrigin(port, extensionOrigin);
  const origin = existing?.origin && existing.origin !== "unknown://" ? existing.origin : resolvedOrigin;

  portContexts.set(port, {
    origin,
    namespace: snapshot.namespace,
    meta: snapshot.meta,
    chainRef: snapshot.chain.chainRef,
    chainId: snapshot.chain.chainId,
  });
};

export const syncAllPortContexts = (
  connections: Iterable<Runtime.Port>,
  snapshotByPort: (port: Runtime.Port) => ProviderBridgeSnapshot | null,
  portContexts: Map<Runtime.Port, PortContext>,
  extensionOrigin: string,
) => {
  for (const port of connections) {
    const snapshot = snapshotByPort(port);
    if (!snapshot) continue;
    syncPortContext(port, snapshot, portContexts, extensionOrigin);
  }
};
