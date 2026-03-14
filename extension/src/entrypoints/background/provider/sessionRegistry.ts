import type { Runtime } from "webextension-polyfill";
import type { PortContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderSessionRegistryDeps = {
  createPortId: () => string;
};

export const createProviderSessionRegistry = ({ createPortId }: ProviderSessionRegistryDeps) => {
  const connections = new Set<Runtime.Port>();
  const pendingRequests = new Map<Runtime.Port, Map<string, PendingEntry>>();
  const portContexts = new Map<Runtime.Port, PortContext>();
  const sessionByPort = new Map<Runtime.Port, string>();
  const portIdByPort = new Map<Runtime.Port, string>();

  const registerConnectedPort = (port: Runtime.Port, initialContext: PortContext) => {
    connections.add(port);
    if (!portIdByPort.has(port)) {
      portIdByPort.set(port, createPortId());
    }
    if (!portContexts.has(port)) {
      portContexts.set(port, initialContext);
    }
  };

  const countConnectedPorts = () => {
    return connections.size;
  };

  const listConnectedPorts = () => {
    return [...connections];
  };

  const listConnectedNamespaces = () => {
    const namespaces = new Set<string>();
    for (const portContext of portContexts.values()) {
      if (portContext.providerNamespace) {
        namespaces.add(portContext.providerNamespace);
      }
    }
    return [...namespaces];
  };

  const listPortsBoundToNamespaces = (namespaces: Iterable<string>) => {
    const allowed = new Set(namespaces);
    return listConnectedPorts().filter((port) => {
      const namespace = portContexts.get(port)?.providerNamespace;
      return typeof namespace === "string" && allowed.has(namespace);
    });
  };

  const readPortContext = (port: Runtime.Port) => {
    return portContexts.get(port);
  };

  const writePortContext = (port: Runtime.Port, context: PortContext) => {
    portContexts.set(port, context);
  };

  const readSessionId = (port: Runtime.Port) => {
    return sessionByPort.get(port) ?? null;
  };

  const writeSessionId = (port: Runtime.Port, sessionId: string) => {
    sessionByPort.set(port, sessionId);
  };

  const readPortId = (port: Runtime.Port) => {
    return portIdByPort.get(port) ?? null;
  };

  const allocatePortId = (port: Runtime.Port) => {
    const existing = portIdByPort.get(port);
    if (existing) return existing;

    const next = createPortId();
    portIdByPort.set(port, next);
    return next;
  };

  const openPendingRequestMap = (port: Runtime.Port) => {
    let requestMap = pendingRequests.get(port);
    if (!requestMap) {
      requestMap = new Map();
      pendingRequests.set(port, requestMap);
    }
    return requestMap;
  };

  const readPendingRequestMap = (port: Runtime.Port) => {
    return pendingRequests.get(port);
  };

  const dropPendingRequests = (port: Runtime.Port) => {
    pendingRequests.delete(port);
  };

  const removePortState = (port: Runtime.Port) => {
    connections.delete(port);
    pendingRequests.delete(port);
    portContexts.delete(port);
    sessionByPort.delete(port);
    portIdByPort.delete(port);
  };

  const clearAllState = () => {
    connections.clear();
    pendingRequests.clear();
    portContexts.clear();
    sessionByPort.clear();
    portIdByPort.clear();
  };

  return {
    registerConnectedPort,
    countConnectedPorts,
    listConnectedPorts,
    listConnectedNamespaces,
    listPortsBoundToNamespaces,
    readPortContext,
    writePortContext,
    readSessionId,
    writeSessionId,
    readPortId,
    allocatePortId,
    openPendingRequestMap,
    readPendingRequestMap,
    dropPendingRequests,
    removePortState,
    clearAllState,
  };
};
