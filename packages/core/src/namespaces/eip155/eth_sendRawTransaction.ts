import { z } from "zod";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import {
  ChainJsonRpcOutcomeUnknownError,
  ChainJsonRpcResponseError,
  ChainJsonRpcUnavailableError,
} from "../../chainJsonRpc/errors.js";
import { type DappRequestMethod, defineDappMethod, invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import { NetworkNotFoundError } from "../../networks/errors.js";
import {
  RpcChainUnavailableError,
  RpcInternalError,
  RpcJsonRpcResponseError,
  RpcOutcomeUnknownError,
} from "../../rpc/errors.js";
import { decodeHexBytes } from "./rpcHex.js";

const SEND_RAW_TRANSACTION_PARAMS_SCHEMA = z.tuple([z.string()]);

const decodeSendRawTransactionParams = (params: unknown, method: string) => {
  const [rawTransaction] = SEND_RAW_TRANSACTION_PARAMS_SCHEMA.parse(params);
  const encoded = decodeHexBytes(rawTransaction, method, "rawTransaction");
  if (encoded === "0x") {
    throw invalidDappParams(method, "rawTransaction must not be empty.");
  }
  return encoded;
};

export const createEip155SendRawTransactionMethod = (chainJsonRpc: ChainJsonRpc): DappRequestMethod =>
  defineDappMethod({
    decode: decodeSendRawTransactionParams,
    execute: async ({ chainRef, params }) => {
      try {
        return await chainJsonRpc.request({
          chainRef,
          method: "eth_sendRawTransaction",
          params: [params],
          replay: "forbidden",
        });
      } catch (error) {
        if (error instanceof ChainJsonRpcOutcomeUnknownError) {
          throw new RpcOutcomeUnknownError({ message: "Transaction broadcast outcome is unknown." });
        }
        if (error instanceof ChainJsonRpcResponseError) {
          throw new RpcJsonRpcResponseError({
            rpcCode: error.rpcCode,
            message: error.message,
            data: error.rpcData,
          });
        }
        if (error instanceof ChainJsonRpcUnavailableError || error instanceof NetworkNotFoundError) {
          throw new RpcChainUnavailableError();
        }
        throw new RpcInternalError({
          message: "Unable to broadcast the raw EIP-155 transaction.",
          cause: error,
        });
      }
    },
  });
