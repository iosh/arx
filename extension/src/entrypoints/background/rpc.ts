import type { JsonRpcParams } from "@arx/core/rpc";
import type { ProviderRequestEnvelope } from "@arx/core/runtime";
import type { ProviderRpcRequest } from "@arx/provider/protocol";
import type { ProviderSessionContext } from "./types";

export const createCoreProviderRequestEnvelope = (
  portContext: ProviderSessionContext,
  request: ProviderRpcRequest,
): ProviderRequestEnvelope => {
  const coreRequest: ProviderRequestEnvelope = {
    id: request.id,
    jsonrpc: request.jsonrpc,
    method: request.method,
    namespace: portContext.namespace,
  };

  if (request.params !== undefined) {
    coreRequest.params = request.params as JsonRpcParams;
  }

  return coreRequest;
};
