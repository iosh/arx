import type { JsonRpcParams, JsonRpcRequest, RpcInvocationContext } from "@arx/core/rpc";
import type { ProviderRuntimeSurface } from "@arx/core/runtime";
import type { Envelope } from "@arx/provider/protocol";
import type { TransportResponse } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "../origin";
import { buildRpcContext } from "../rpc";
import type { ArxRpcContext, PortContext } from "../types";
import type { PendingEntry } from "./types";

type ProviderRequestExecutorDeps = {
  extensionOrigin: string;
  getProviderBridgeAccess: () => Promise<ProviderRuntimeSurface>;
  getPortContext: (port: Runtime.Port) => PortContext | undefined;
  getOrCreatePortId: (port: Runtime.Port) => string;
  getPendingRequestMap: (port: Runtime.Port) => Map<string, PendingEntry>;
  clearPendingForPort: (port: Runtime.Port) => void;
  sendReply: (port: Runtime.Port, id: string, payload: TransportResponse) => void;
};

export const createProviderRequestExecutor = (deps: ProviderRequestExecutorDeps) => {
  const {
    extensionOrigin,
    getProviderBridgeAccess,
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

    let providerBridgeAccess: ProviderRuntimeSurface | null = null;

    try {
      providerBridgeAccess = await getProviderBridgeAccess();
      const response = await providerBridgeAccess.executeRpcRequest(request);

      sendReply(port, envelope.id, response as TransportResponse);
    } catch (error) {
      const rpcError = providerBridgeAccess
        ? providerBridgeAccess.encodeRpcError(error, {
            origin,
            method,
            rpcContext: request.arx,
          })
        : ({ code: -32603, message: "Internal error" } as const);

      sendReply(port, envelope.id, {
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
