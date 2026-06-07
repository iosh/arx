import type { JsonRpcParams, JsonRpcRequest } from "@arx/core";
import type { ProviderRuntimeRpcError } from "@arx/core/runtime";

export type ProviderRpcId = JsonRpcRequest<JsonRpcParams>["id"];
export type ProviderRpcRequest = JsonRpcRequest<JsonRpcParams>;
export type ProviderRpcResponse =
  | {
      id: ProviderRpcId;
      jsonrpc: "2.0";
      result: unknown;
    }
  | {
      id: ProviderRpcId;
      jsonrpc: "2.0";
      error: ProviderRuntimeRpcError;
    };
