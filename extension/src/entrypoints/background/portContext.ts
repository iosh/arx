import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import type { PortContext, ProviderBridgeSnapshot, ProviderSessionContext } from "./types";

export type PortContextStore = {
  readPortContext: (port: Runtime.Port) => PortContext | undefined;
  writePortContext: (port: Runtime.Port, context: ProviderSessionContext) => void;
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
    namespace: snapshot.namespace,
  });
};
