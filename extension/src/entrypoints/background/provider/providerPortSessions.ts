import type { Runtime } from "webextension-polyfill";
import type { ConnectedPortContext, PortContext, ProviderSessionContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderPortSessionsDeps = {
  createPortId: () => string;
};

export const createProviderPortSessions = ({ createPortId }: ProviderPortSessionsDeps) => {
  const connectedPorts = new Set<Runtime.Port>();
  const pendingRequestsByPort = new Map<Runtime.Port, Map<string, PendingEntry>>();
  const contextByPort = new Map<Runtime.Port, PortContext>();
  const sessionByPort = new Map<Runtime.Port, string>();
  const portIdByPort = new Map<Runtime.Port, string>();

  const registerConnectedPort = (port: Runtime.Port, initialContext: ConnectedPortContext) => {
    connectedPorts.add(port);
    if (!portIdByPort.has(port)) {
      portIdByPort.set(port, createPortId());
    }
    if (!contextByPort.has(port)) {
      contextByPort.set(port, initialContext);
    }
  };

  const countConnectedPorts = () => {
    return connectedPorts.size;
  };

  const listConnectedPorts = () => {
    return [...connectedPorts];
  };

  const readPortContext = (port: Runtime.Port) => {
    return contextByPort.get(port);
  };

  const writePortContext = (port: Runtime.Port, context: ProviderSessionContext) => {
    contextByPort.set(port, context);
  };

  const readSessionContext = (port: Runtime.Port): ProviderSessionContext | null => {
    const portContext = contextByPort.get(port);
    return portContext && "providerNamespace" in portContext ? portContext : null;
  };

  const readSessionId = (port: Runtime.Port) => {
    return sessionByPort.get(port) ?? null;
  };

  const writeSessionId = (port: Runtime.Port, sessionId: string) => {
    sessionByPort.set(port, sessionId);
  };

  const clearSessionId = (port: Runtime.Port) => {
    sessionByPort.delete(port);
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
    let requestMap = pendingRequestsByPort.get(port);
    if (!requestMap) {
      requestMap = new Map();
      pendingRequestsByPort.set(port, requestMap);
    }
    return requestMap;
  };

  const readPendingRequestMap = (port: Runtime.Port) => {
    return pendingRequestsByPort.get(port);
  };

  const dropPendingRequests = (port: Runtime.Port) => {
    pendingRequestsByPort.delete(port);
  };

  const removePortState = (port: Runtime.Port) => {
    connectedPorts.delete(port);
    pendingRequestsByPort.delete(port);
    contextByPort.delete(port);
    sessionByPort.delete(port);
    portIdByPort.delete(port);
  };

  return {
    registerConnectedPort,
    countConnectedPorts,
    listConnectedPorts,
    readPortContext,
    readSessionContext,
    writePortContext,
    readSessionId,
    writeSessionId,
    clearSessionId,
    readPortId,
    allocatePortId,
    openPendingRequestMap,
    readPendingRequestMap,
    dropPendingRequests,
    removePortState,
  };
};
