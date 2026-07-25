import { z } from "zod";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import {
  type DappNamespace,
  type DappRequest,
  decodeDappParams,
  decodeNoParams,
  defineDappMethod,
} from "../../dappConnections/routeDappRequest.js";
import type { JsonObject, JsonValue } from "../../errors.js";
import { chainIdFromChainRef } from "./chainId.js";

type JsonRpcParams = JsonValue[] | JsonObject;

const JSON_RPC_PARAMS_SCHEMA: z.ZodType<JsonRpcParams> = z.union([z.array(z.json()), z.record(z.string(), z.json())]);

const EIP155_NODE_READ_METHODS: ReadonlySet<string> = new Set(["eth_blockNumber"]);

const decodeJsonRpcParams = (params: unknown, method: string): JsonRpcParams | undefined => {
  if (params === undefined) return undefined;
  return decodeDappParams(params, method, (rawParams) => JSON_RPC_PARAMS_SCHEMA.parse(rawParams));
};

export const createEip155DappNamespace = (chainJsonRpc: ChainJsonRpc): DappNamespace => {
  return {
    localMethods: new Map([
      [
        "eth_chainId",
        defineDappMethod({
          decode: decodeNoParams,
          execute: async ({ chainRef }) => `0x${chainIdFromChainRef(chainRef).toString(16)}`,
        }),
      ],
    ]),
    nodeReadMethods: EIP155_NODE_READ_METHODS,
    forwardNodeRead: ({ chainRef, method, params }: DappRequest) => {
      const decodedParams = decodeJsonRpcParams(params, method);
      return chainJsonRpc.request({
        chainRef,
        method,
        ...(decodedParams !== undefined ? { params: decodedParams } : {}),
        replay: "allowed",
      });
    },
  };
};
