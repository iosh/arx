import type { JsonObject, JsonValue } from "../errors.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { RpcEndpoint } from "../networks/types.js";

export type ChainJsonRpcTarget =
  | Readonly<{ chainRef: ChainRef; endpoint?: never }>
  | Readonly<{ endpoint: RpcEndpoint; chainRef?: never }>;

export type JsonRpcParams = readonly JsonValue[] | JsonObject;
