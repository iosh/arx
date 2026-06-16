import type { JsonRpcParams, JsonRpcRequest } from "@arx/core";
import type { ProviderRpcRequest } from "@arx/core/runtime";

export const createCoreProviderRpcRequest = (request: JsonRpcRequest<JsonRpcParams>): ProviderRpcRequest => {
  const coreRequest: ProviderRpcRequest = {
    id: request.id,
    jsonrpc: request.jsonrpc,
    method: request.method,
  };

  if (request.params !== undefined) {
    coreRequest.params = request.params;
  }

  return coreRequest;
};
