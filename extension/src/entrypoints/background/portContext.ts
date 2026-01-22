import { DEFAULT_NAMESPACE, getRegisteredNamespaceAdapters } from "@arx/core";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import type { ControllerSnapshot, PortContext } from "./types";

const isNamespaceRegistered = (namespace: string | null | undefined) => {
  if (!namespace || namespace.length === 0) {
    return false;
  }
  return getRegisteredNamespaceAdapters().some((adapter) => adapter.namespace === namespace);
};

export const deriveNamespace = (chainRef: string | null, metaNamespace?: string): string => {
  if (metaNamespace) {
    if (isNamespaceRegistered(metaNamespace)) {
      return metaNamespace;
    }
    console.warn(
      `[background] Namespace "${metaNamespace}" has no registered adapter; falling back to ${DEFAULT_NAMESPACE}`,
    );
    return DEFAULT_NAMESPACE;
  }
  if (chainRef) {
    const [namespace] = chainRef.split(":");
    if (namespace && isNamespaceRegistered(namespace)) {
      return namespace;
    }
  }
  return DEFAULT_NAMESPACE;
};

export const syncPortContext = (
  port: Runtime.Port,
  snapshot: ControllerSnapshot,
  portContexts: Map<Runtime.Port, PortContext>,
  extensionOrigin: string,
) => {
  const existing = portContexts.get(port);
  const resolvedOrigin = getPortOrigin(port, extensionOrigin);
  const origin = existing?.origin && existing.origin !== "unknown://" ? existing.origin : resolvedOrigin;

  // meta.activeChain and chain.chainRef come from the same source; meta is checked first for future per-port overrides;
  const chainRef = snapshot.meta?.activeChain ?? snapshot.chain.chainRef ?? null;
  const namespace = deriveNamespace(chainRef, snapshot.meta?.activeNamespace);

  portContexts.set(port, {
    origin,
    meta: snapshot.meta ?? null,
    chainRef,
    chainId: snapshot.chain.chainId ?? null,
    namespace,
  });
};

export const syncAllPortContexts = (
  connections: Iterable<Runtime.Port>,
  snapshot: ControllerSnapshot,
  portContexts: Map<Runtime.Port, PortContext>,
  extensionOrigin: string,
) => {
  for (const port of connections) {
    syncPortContext(port, snapshot, portContexts, extensionOrigin);
  }
};
