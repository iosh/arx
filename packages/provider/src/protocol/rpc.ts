import type { JsonRpcParams, JsonRpcRequest, JsonRpcResponse } from "@arx/core";

export type ProviderRpcId = JsonRpcRequest<JsonRpcParams>["id"];
export type ProviderRpcRequest = JsonRpcRequest<JsonRpcParams>;
export type ProviderRpcResponse = JsonRpcResponse;
