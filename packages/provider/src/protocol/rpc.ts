import type { JsonRpcParams } from "@arx/core";
import type { ProviderRpcError } from "@arx/core/provider";

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
      error: ProviderRpcError;
    };
