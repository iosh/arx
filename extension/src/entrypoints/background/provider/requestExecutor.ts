import type { WalletProvider } from "@arx/core/engine";
import type { JsonRpcParams } from "@arx/core/rpc";
import type {
  ProviderRuntimeRequestContext,
  ProviderRuntimeRpcContext,
  ProviderRuntimeRpcRequest,
} from "@arx/core/runtime";
import type { Envelope, ProviderRpcResponse } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import { buildRpcContext } from "../rpc";
import type { PortContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderRequestExecutorDeps = {
  extensionOrigin: string;
  getProvider: () => Promise<WalletProvider>;
  getPortContext: (port: Runtime.Port) => PortContext | undefined;
  getOrCreatePortId: (port: Runtime.Port) => string;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry>;
  clearPendingForPort: (port: Runtime.Port) => void;
  sendReply: (port: Runtime.Port, sessionId: string, id: string, payload: ProviderRpcResponse) => void;
};

export const createProviderRequestExecutor = (deps: ProviderRequestExecutorDeps) => {
  const {
    extensionOrigin,
    getProvider,
    getPortContext,
    getOrCreatePortId,
    getPendingRequestMap,
    clearPendingForPort,
    sendReply,
  } = deps;

  const handleRpcRequest = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
    const { id: rpcId, jsonrpc, method } = envelope.payload;
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, { rpcId, jsonrpc });

    const portContext = getPortContext(port);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const rpcContext = buildRpcContext(portContext);
    const portId = getOrCreatePortId(port);

    const requestContext: ProviderRuntimeRequestContext = {
      transport: "provider" as const,
      portId,
      sessionId: envelope.sessionId,
      requestId: String(rpcId),
      origin,
    };
    const context: ProviderRuntimeRpcContext | undefined = rpcContext
      ? {
          ...(rpcContext.providerNamespace !== undefined ? { providerNamespace: rpcContext.providerNamespace } : {}),
          requestContext,
        }
      : undefined;

    const request: ProviderRuntimeRpcRequest = {
      id: envelope.payload.id,
      jsonrpc: envelope.payload.jsonrpc,
      method: envelope.payload.method,
      params: envelope.payload.params as JsonRpcParams,
      origin,
      ...(context ? { context } : {}),
    };

    let provider: WalletProvider | null = null;

    try {
      provider = await getProvider();
      const response = await provider.executeRpcRequest(request);

      sendReply(port, envelope.sessionId, envelope.id, response as ProviderRpcResponse);
    } catch (error) {
      const rpcError = provider
        ? provider.encodeRpcError(error, {
            origin,
            method,
            rpcContext: context,
          })
        : ({ code: -32603, message: "Internal error" } as const);

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
