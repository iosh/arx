import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import type { ControllerSnapshot, PortContext } from "./types";

export const syncPortContext = (
  port: Runtime.Port,
  snapshot: ControllerSnapshot,
  portContexts: Map<Runtime.Port, PortContext>,
  extensionOrigin: string,
  _registeredNamespaces?: ReadonlySet<string>,
) => {
  const existing = portContexts.get(port);
  const resolvedOrigin = getPortOrigin(port, extensionOrigin);
  const origin = existing?.origin && existing.origin !== "unknown://" ? existing.origin : resolvedOrigin;

  const chainRef = snapshot.meta?.activeChain ?? snapshot.chain.chainRef ?? null;

  portContexts.set(port, {
    origin,
    meta: snapshot.meta ?? null,
    chainRef,
    chainId: snapshot.chain.chainId ?? null,
    namespace: existing?.namespace ?? null,
  });
};

export const syncAllPortContexts = (
  connections: Iterable<Runtime.Port>,
  snapshot: ControllerSnapshot,
  portContexts: Map<Runtime.Port, PortContext>,
  extensionOrigin: string,
  _registeredNamespaces?: ReadonlySet<string>,
) => {
  for (const port of connections) {
    syncPortContext(port, snapshot, portContexts, extensionOrigin, _registeredNamespaces);
  }
};
