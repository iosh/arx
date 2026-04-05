import type { WalletProvider } from "@arx/core/engine";
import { ArxReasons, arxError } from "@arx/core/errors";
import type { JsonRpcError } from "@arx/core/rpc";
import { CHANNEL, type Envelope, PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import { buildRpcContext, deriveRpcContextNamespace } from "../rpc";
import type { PortContext } from "../types";
import type { ProviderBinding } from "./bindingRegistry";
import type { PendingEntry } from "./types";

type ProviderDisconnectFinalizerDeps = {
  extensionOrigin: string;
  getProvider: () => WalletProvider | null;
  getSessionIdForPort: (port: Runtime.Port) => string | null;
  getPortContext: (port: Runtime.Port) => PortContext | undefined;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry> | undefined;
  clearPendingForPort: (port: Runtime.Port) => void;
  detachPortListeners: (port: Runtime.Port) => void;
  postEnvelope: (port: Runtime.Port, envelope: Envelope) => boolean;
  releaseBinding: (port: Runtime.Port) => { binding: ProviderBinding; bindingBecameInactive: boolean } | null;
  removePortState: (port: Runtime.Port) => void;
  cancelApprovalsForSession: (port: Runtime.Port, sessionId: string, logReason: string) => Promise<void>;
  portLog: (message: string, details?: Record<string, unknown>) => void;
};

export const createProviderDisconnectFinalizer = (deps: ProviderDisconnectFinalizerDeps) => {
  const {
    extensionOrigin,
    getProvider,
    getSessionIdForPort,
    getPortContext,
    getPendingRequestMap,
    clearPendingForPort,
    detachPortListeners,
    postEnvelope,
    releaseBinding,
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
    const provider = getProvider();
    const disconnectError = arxError({ reason: ArxReasons.TransportDisconnected, message: "Disconnected" });

    if (!provider) {
      return { code: 4900, message: "Disconnected" } as const;
    }

    return provider.encodeRpcError(disconnectError, {
      origin,
      method: PROVIDER_EVENTS.disconnect,
      rpcContext,
    }) as JsonRpcError;
  };

  const disconnectPort = (port: Runtime.Port) => {
    try {
      port.disconnect();
    } catch {
      // ignore disconnect failure
    }
  };

  const rejectPendingWithDisconnectForSession = (
    port: Runtime.Port,
    sessionId: string,
    overrideError?: JsonRpcError,
  ) => {
    const requestMap = getPendingRequestMap(port);
    if (!requestMap) return;

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

  const rejectPendingWithDisconnect = (port: Runtime.Port, overrideError?: JsonRpcError) => {
    const sessionId = getSessionIdForPort(port);
    if (!sessionId) {
      clearPendingForPort(port);
      return;
    }

    rejectPendingWithDisconnectForSession(port, sessionId, overrideError);
  };

  const cleanupPortState = (port: Runtime.Port) => {
    releaseBinding(port);
    removePortState(port);
    detachPortListeners(port);
  };

  const finalizeSessionRotation = (port: Runtime.Port, sessionId: string) => {
    void cancelApprovalsForSession(port, sessionId, "failed to expire approvals on session rotation");

    try {
      rejectPendingWithDisconnectForSession(port, sessionId);
    } catch (error) {
      const origin = getPortOrigin(port, extensionOrigin);
      portLog("session rotation cleanup error", { origin, error, sessionId });
    }
  };

  const dropStalePort = (port: Runtime.Port, reason: string, error?: unknown) => {
    const sessionId = getSessionIdForPort(port);
    if (sessionId) {
      void cancelApprovalsForSession(port, sessionId, "failed to expire approvals on stale port");
    }

    cleanupPortState(port);
    disconnectPort(port);

    const origin = getPortOrigin(port, extensionOrigin);
    portLog("drop stale port", { origin, reason, error });
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
      portLog("disconnect cleanup error", { origin, error });
    } finally {
      cleanupPortState(port);
    }

    const origin = getPortOrigin(port, extensionOrigin);
    portLog("disconnect", { origin });
  };

  const broadcastDisconnectForPorts = (ports: Runtime.Port[]) => {
    for (const port of ports) {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) continue;

      const error = encodeDisconnectError(port);
      const portContext = getPortContext(port);
      const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);
      const origin = getPortOrigin(port, extensionOrigin);
      const namespace = deriveRpcContextNamespace(rpcContext);

      void cancelApprovalsForSession(port, sessionId, "failed to expire approvals on provider disconnect");

      rejectPendingWithDisconnectForSession(port, sessionId, error);

      const delivered = postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.disconnect, params: [error] },
      });
      cleanupPortState(port);
      disconnectPort(port);

      portLog("broadcastDisconnect", {
        origin,
        errorCode: error.code,
        namespace,
        delivered,
      });
    }
  };

  return {
    finalizeSessionRotation,
    dropStalePort,
    rejectPendingWithDisconnect,
    finalizePortDisconnect,
    broadcastDisconnectForPorts,
  };
};
