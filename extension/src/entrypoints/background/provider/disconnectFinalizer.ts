import { ArxReasons, arxError } from "@arx/core/errors";
import type { JsonRpcError, RpcRegistry } from "@arx/core/rpc";
import { CHANNEL, type Envelope, PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import { buildRpcContext, deriveRpcContextNamespace } from "../rpc";
import type { PortContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderDisconnectFinalizerDeps = {
  extensionOrigin: string;
  getRpcRegistry: () => RpcRegistry | null;
  getSessionIdForPort: (port: Runtime.Port) => string | null;
  getPortContext: (port: Runtime.Port) => PortContext | undefined;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry> | undefined;
  clearPendingForPort: (port: Runtime.Port) => void;
  detachPortListeners: (port: Runtime.Port) => void;
  postEnvelope: (port: Runtime.Port, envelope: Envelope) => boolean;
  removePortState: (port: Runtime.Port) => void;
  cancelApprovalsForSession: (port: Runtime.Port, sessionId: string, logReason: string) => Promise<void>;
  portLog: (message: string, details?: Record<string, unknown>) => void;
};

const toErrorDetails = (error: unknown): Record<string, string> => {
  if (!error) return {};
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { error: String(error) };
};

export const createProviderDisconnectFinalizer = (deps: ProviderDisconnectFinalizerDeps) => {
  const {
    extensionOrigin,
    getRpcRegistry,
    getSessionIdForPort,
    getPortContext,
    getPendingRequestMap,
    clearPendingForPort,
    detachPortListeners,
    postEnvelope,
    removePortState,
    cancelApprovalsForSession,
    portLog,
  } = deps;

  const encodeDisconnectError = (port: Runtime.Port, overrideError?: JsonRpcError): JsonRpcError => {
    if (overrideError) {
      return overrideError;
    }

    const portContext = getPortContext(port);
    const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const namespace = deriveRpcContextNamespace(rpcContext);
    const chainRef = rpcContext?.chainRef ?? null;

    return (getRpcRegistry()?.encodeErrorWithAdapters(
      arxError({ reason: ArxReasons.TransportDisconnected, message: "Disconnected" }),
      { surface: "dapp", namespace, chainRef, origin, method: PROVIDER_EVENTS.disconnect },
    ) ?? ({ code: 4900, message: "Disconnected" } as const)) as JsonRpcError;
  };

  const rejectPendingWithDisconnect = (port: Runtime.Port, overrideError?: JsonRpcError) => {
    const requestMap = getPendingRequestMap(port);
    if (!requestMap) return;

    const sessionId = getSessionIdForPort(port);
    if (!sessionId) {
      clearPendingForPort(port);
      return;
    }

    const error = encodeDisconnectError(port, overrideError);
    for (const [messageId, { rpcId, jsonrpc }] of requestMap) {
      postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "response",
        id: messageId,
        payload: {
          id: rpcId,
          jsonrpc,
          error,
        },
      });
    }

    clearPendingForPort(port);
  };

  const cleanupPortState = (port: Runtime.Port) => {
    removePortState(port);
    detachPortListeners(port);
  };

  const dropStalePort = (port: Runtime.Port, reason: string, error?: unknown) => {
    const sessionId = getSessionIdForPort(port);
    if (sessionId) {
      void cancelApprovalsForSession(port, sessionId, "failed to expire approvals on stale port");
    }

    cleanupPortState(port);

    try {
      port.disconnect();
    } catch {
      // ignore disconnect failure
    }

    const origin = getPortOrigin(port, extensionOrigin);
    portLog("drop stale port", { origin, reason, ...toErrorDetails(error) });
  };

  const finalizePortDisconnect = (port: Runtime.Port) => {
    const sessionId = getSessionIdForPort(port);
    if (sessionId) {
      void cancelApprovalsForSession(port, sessionId, "failed to expire approvals on disconnect");
    }

    try {
      rejectPendingWithDisconnect(port);
    } catch (error) {
      const origin = getPortOrigin(port, extensionOrigin);
      portLog("disconnect cleanup error", { origin, ...toErrorDetails(error) });
    } finally {
      cleanupPortState(port);
    }

    const origin = getPortOrigin(port, extensionOrigin);
    portLog("disconnect", { origin });
  };

  const broadcastDisconnectForPorts = (ports: Runtime.Port[]) => {
    const stalePorts: Runtime.Port[] = [];

    for (const port of ports) {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) continue;

      const error = encodeDisconnectError(port);
      rejectPendingWithDisconnect(port, error);

      const success = postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.disconnect, params: [error] },
      });

      if (success) {
        const portContext = getPortContext(port);
        const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);
        const origin = getPortOrigin(port, extensionOrigin);
        const namespace = deriveRpcContextNamespace(rpcContext);
        portLog("broadcastDisconnect", { origin, errorCode: error.code, namespace });
        continue;
      }

      stalePorts.push(port);
    }

    for (const port of stalePorts) {
      dropStalePort(port, "broadcast_disconnect_failed");
    }
  };

  return {
    dropStalePort,
    rejectPendingWithDisconnect,
    finalizePortDisconnect,
    broadcastDisconnectForPorts,
  };
};
