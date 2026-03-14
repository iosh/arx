import type { JsonRpcError, JsonRpcParams, JsonRpcRequest, RpcInvocationContext, RpcRegistry } from "@arx/core/rpc";
import type { Envelope } from "@arx/provider/protocol";
import type { TransportResponse } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import { buildRpcContext, deriveRpcContextNamespace } from "../rpc";
import type { BackgroundContext } from "../runtimeHost";
import type { ArxRpcContext, PortContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderRequestExecutorDeps = {
  extensionOrigin: string;
  getContext: () => Promise<BackgroundContext>;
  getRpcRegistry: () => RpcRegistry | null;
  getPortContext: (port: Runtime.Port) => PortContext | undefined;
  getOrCreatePortId: (port: Runtime.Port) => string;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry>;
  clearPendingForPort: (port: Runtime.Port) => void;
  sendReply: (port: Runtime.Port, id: string, payload: TransportResponse) => void;
};

export const createProviderRequestExecutor = (deps: ProviderRequestExecutorDeps) => {
  const {
    extensionOrigin,
    getContext,
    getRpcRegistry,
    getPortContext,
    getOrCreatePortId,
    getPendingRequestMap,
    clearPendingForPort,
    sendReply,
  } = deps;

  const handleRpcRequest = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
    const { engine } = await getContext();
    const { id: rpcId, jsonrpc, method } = envelope.payload;
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, { rpcId, jsonrpc });

    const portContext = getPortContext(port);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);
    const portId = getOrCreatePortId(port);

    const requestContext = {
      transport: "provider" as const,
      portId,
      sessionId: envelope.sessionId,
      requestId: String(rpcId),
      origin,
    };

    const request: JsonRpcRequest<JsonRpcParams> & ArxRpcContext = {
      id: envelope.payload.id,
      jsonrpc: envelope.payload.jsonrpc,
      method: envelope.payload.method,
      params: envelope.payload.params as JsonRpcParams,
      origin,
      ...(rpcContext && {
        arx: {
          chainRef: rpcContext.chainRef,
          ...(rpcContext.namespace ? { namespace: rpcContext.namespace } : {}),
          ...(rpcContext.providerNamespace ? { providerNamespace: rpcContext.providerNamespace } : {}),
          requestContext,
          meta: rpcContext.meta,
        } satisfies RpcInvocationContext,
      }),
    };

    try {
      const response = await new Promise<TransportResponse>((resolve, reject) => {
        engine.handle(request, (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result as TransportResponse);
        });
      });

      sendReply(port, envelope.id, response);
    } catch (error) {
      sendReply(port, envelope.id, {
        id: rpcId,
        jsonrpc,
        error: (getRpcRegistry()?.encodeErrorWithAdapters(error, {
          surface: "dapp",
          namespace: deriveRpcContextNamespace(rpcContext),
          chainRef: rpcContext?.chainRef ?? null,
          origin,
          method,
        }) ?? ({ code: -32603, message: "Internal error" } as const)) as JsonRpcError,
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
