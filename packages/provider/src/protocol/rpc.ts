import type { JsonRpcParams } from "@arx/core";
import type { ProviderRuntimeRpcError } from "@arx/core/runtime";

export type ProviderRpcParams = JsonRpcParams;
export type ProviderRpcRequest = {
  method: string;
  params?: ProviderRpcParams;
};
export type ProviderRpcResponse =
  | {
      result: unknown;
    }
  | {
      error: ProviderRuntimeRpcError;
    };
