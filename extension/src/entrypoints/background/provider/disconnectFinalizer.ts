import type { WalletProvider } from "@arx/core/engine";
import { type ProviderRuntimeRpcError, TransportDisconnectedError } from "@arx/core/runtime";
import { CHANNEL, type Envelope } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import type { ProviderConnectionScope } from "./providerPortConnections";
import type { PendingEntry } from "./types";

type ProviderDisconnectFinalizerDeps = {
  getProvider: () => WalletProvider | null;
  getSessionIdForPort: (port: Runtime.Port) => string | null;
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
};

export const createProviderDisconnectFinalizer = (deps: ProviderDisconnectFinalizerDeps) => {
  const {
    getProvider,
    getSessionIdForPort,
    getPendingRequestMap,
    clearPendingForPort,
    detachPortListeners,
    postEnvelope,
    detachPortFromConnection,
    removePortState,
    cancelRequestScope,
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
    for (const messageId of requestMap.keys()) {
      postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "response",
        id: messageId,
        payload: {
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
    } catch {
      // The port is already rotating; pending replies are best-effort.
    }
  };

  const dropStalePort = (port: Runtime.Port, _reason: string, _error?: unknown) => {
    const sessionId = getSessionIdForPort(port);
    if (sessionId) {
      void cancelRequestScope(port, sessionId, "failed to expire request scope on stale port");
    }

    cleanupPortState(port);
    disconnectPort(port);
  };

  const finalizePortDisconnect = (port: Runtime.Port) => {
    const sessionId = getSessionIdForPort(port);
    if (sessionId) {
      void cancelRequestScope(port, sessionId, "failed to expire request scope on disconnect");
    }

    try {
      rejectPendingWithDisconnect(port);
    } catch {
      // The port is already disconnected; pending replies are best-effort.
    } finally {
      cleanupPortState(port);
    }
  };

  const broadcastDisconnectForPorts = (ports: Runtime.Port[]) => {
    for (const port of ports) {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) continue;

      const error = encodeDisconnectError();

      void cancelRequestScope(port, sessionId, "failed to expire request scope on provider disconnect");

      rejectPendingWithDisconnectForSession(port, sessionId, error);

      cleanupPortState(port);
      disconnectPort(port);
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
