import type { JsonRpcVersion2 } from "@arx/core";
import type { ProviderRpcId } from "@arx/provider/protocol";

export type PendingEntry = {
  rpcId: ProviderRpcId;
  jsonrpc: JsonRpcVersion2;
};
