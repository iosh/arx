import type { JsonRpcId, JsonRpcVersion2 } from "@arx/provider/types";

export type PendingEntry = {
  rpcId: JsonRpcId;
  jsonrpc: JsonRpcVersion2;
};
