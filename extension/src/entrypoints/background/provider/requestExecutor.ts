import type { WalletProvider } from "@arx/core/engine";
import type { JsonRpcParams } from "@arx/core/rpc";
import type {
  ProviderRuntimeRequestExecution,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcRequest,
} from "@arx/core/runtime";
import type { Envelope, ProviderRpcResponse } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { buildProviderRpcContext } from "../rpc";
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
    const { id: rpcId, jsonrpc } = envelope.payload;
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, { rpcId, jsonrpc });

    const sessionContext = getSessionContext(port);
    const origin = sessionContext.origin;
    const providerContext = buildProviderRpcContext(sessionContext);
    const portId = getOrCreatePortId(port);

    const requestScope: ProviderRuntimeRequestScope = {
      transport: "provider" as const,
      origin,
      portId,
      sessionId: envelope.sessionId,
    };
    const execution: ProviderRuntimeRequestExecution = { requestScope };

    const request: ProviderRuntimeRpcRequest = {
      id: envelope.payload.id,
      jsonrpc: envelope.payload.jsonrpc,
      method: envelope.payload.method,
      params: envelope.payload.params as JsonRpcParams,
      origin,
      context: providerContext,
      execution,
    };

    let provider: WalletProvider | null = null;

    try {
      provider = await getProvider();
      const response = await provider.executeRpcRequest(request);

      sendReply(port, envelope.sessionId, envelope.id, response as ProviderRpcResponse);
    } catch (error) {
      const rpcError = provider
        ? provider.encodeRuntimeRpcError(error)
        : ({ kind: "JsonRpcError", code: -32603, message: "Internal error" } as const);

      sendReply(port, envelope.sessionId, envelope.id, {
        id: rpcId,
        jsonrpc,
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
