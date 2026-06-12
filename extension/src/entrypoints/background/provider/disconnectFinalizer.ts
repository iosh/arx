import type { WalletProvider } from "@arx/core/engine";
import { type ProviderRuntimeRpcError, TransportDisconnectedError } from "@arx/core/runtime";
import { CHANNEL, type Envelope, PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import type { ProviderSessionContext } from "../types";
import type { ProviderConnectionScope } from "./providerPortConnections";
import type { PendingEntry } from "./types";

type ProviderDisconnectFinalizerDeps = {
  extensionOrigin: string;
  getProvider: () => WalletProvider | null;
  getSessionIdForPort: (port: Runtime.Port) => string | null;
  getSessionContext: (port: Runtime.Port) => ProviderSessionContext | null;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry> | undefined;
  clearPendingForPort: (port: Runtime.Port) => void;
  detachPortListeners: (port: Runtime.Port) => void;
  postEnvelope: (port: Runtime.Port, envelope: Envelope) => boolean;
  detachPortFromConnection: (port: Runtime.Port) => {
    scope: ProviderConnectionScope;
    scopeBecameInactive: boolean;
  } | null;
  removePortState: (port: Runtime.Port) => void;
  cancelRequestScope: (port: Runtime.Port, sessionId: string, logReason: string) => Promise<void>;
  portLog: (message: string, details?: Record<string, unknown>) => void;
};

export const createProviderDisconnectFinalizer = (deps: ProviderDisconnectFinalizerDeps) => {
  const {
    extensionOrigin,
    getProvider,
    getSessionIdForPort,
    getSessionContext,
    getPendingRequestMap,
    clearPendingForPort,
    detachPortListeners,
    postEnvelope,
    detachPortFromConnection,
    removePortState,
    cancelRequestScope,
    portLog,
  } = deps;

  const encodeDisconnectError = (overrideError?: ProviderRuntimeRpcError): ProviderRuntimeRpcError => {
    if (overrideError) {
      return overrideError;
    }

    const provider = getProvider();
    const disconnectError = new TransportDisconnectedError({ message: "Disconnected" });

    if (!provider) {
      return { kind: "ArxError", code: TransportDisconnectedError.code };
    }

    return provider.encodeRuntimeRpcError(disconnectError);
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
    overrideError?: ProviderRuntimeRpcError,
  ) => {
    const requestMap = getPendingRequestMap(port);
    if (!requestMap) return;

    const error = encodeDisconnectError(overrideError);
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

  const rejectPendingWithDisconnect = (port: Runtime.Port, overrideError?: ProviderRuntimeRpcError) => {
    const sessionId = getSessionIdForPort(port);
    if (!sessionId) {
      clearPendingForPort(port);
      return;
    }

    rejectPendingWithDisconnectForSession(port, sessionId, overrideError);
  };

  const cleanupPortState = (port: Runtime.Port) => {
    detachPortFromConnection(port);
    removePortState(port);
    detachPortListeners(port);
  };

  const finalizeSessionRotation = (port: Runtime.Port, sessionId: string) => {
    void cancelRequestScope(port, sessionId, "failed to expire request scope on session rotation");

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
      void cancelRequestScope(port, sessionId, "failed to expire request scope on stale port");
    }

    cleanupPortState(port);
    disconnectPort(port);

    const origin = getPortOrigin(port, extensionOrigin);
    portLog("drop stale port", { origin, reason, error });
  };

  const finalizePortDisconnect = (port: Runtime.Port) => {
    const sessionId = getSessionIdForPort(port);
    if (sessionId) {
      void cancelRequestScope(port, sessionId, "failed to expire request scope on disconnect");
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

      const error = encodeDisconnectError();
      const sessionContext = getSessionContext(port);
      const origin = getPortOrigin(port, extensionOrigin);
      const namespace = sessionContext?.providerNamespace ?? null;

      void cancelRequestScope(port, sessionId, "failed to expire request scope on provider disconnect");

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
