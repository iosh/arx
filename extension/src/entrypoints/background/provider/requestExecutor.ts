import type { WalletProvider } from "@arx/core/engine";
import type { ProviderRequestScope } from "@arx/core/provider";
import type { Envelope, ProviderRpcResponse } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { createCoreProviderRpcRequest } from "../rpc";
import type { ProviderSessionContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderRequestExecutorDeps = {
  getProvider: () => Promise<WalletProvider>;
  getSessionContext: (port: Runtime.Port) => ProviderSessionContext;
  getOrCreatePortId: (port: Runtime.Port) => string;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry>;
  clearPendingForPort: (port: Runtime.Port) => void;
  sendReply: (port: Runtime.Port, sessionId: string, id: string, payload: ProviderRpcResponse) => void;
};

export const createProviderRequestExecutor = (deps: ProviderRequestExecutorDeps) => {
  const { getProvider, getSessionContext, getOrCreatePortId, getPendingRequestMap, clearPendingForPort, sendReply } =
    deps;

  const handleRpcRequest = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, true);

    const sessionContext = getSessionContext(port);
    const origin = sessionContext.origin;
    const portId = getOrCreatePortId(port);

    const requestScope: ProviderRequestScope = {
      transport: "provider" as const,
      origin,
      portId,
      sessionId: envelope.sessionId,
    };
    const request = createCoreProviderRpcRequest({
      id: envelope.id,
      jsonrpc: "2.0",
      ...envelope.payload,
    });

    let provider: WalletProvider | null = null;

    try {
      provider = await getProvider();
      const response = await provider.request({
        scope: requestScope,
        namespace: sessionContext.namespace,
        request,
      });

      if ("error" in response) {
        sendReply(port, envelope.sessionId, envelope.id, { error: response.error });
        return;
      }

      sendReply(port, envelope.sessionId, envelope.id, { result: response.result });
    } catch (error) {
      const rpcError = provider
        ? provider.encodeRpcError(error)
        : ({ kind: "JsonRpcError", code: -32603, message: "Internal error" } as const);

      sendReply(port, envelope.sessionId, envelope.id, {
        error: rpcError,
      });
    } finally {
      pendingRequestMap.delete(envelope.id);
      if (pendingRequestMap.size === 0) {
        clearPendingForPort(port);
      }
    }
  };

  return {
    handleRpcRequest,
  };
};
