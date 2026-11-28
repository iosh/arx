import { z } from "zod";
import { ChainJsonRpcHttpTransportError } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import { type DappRequestMethod, defineDappMethod, invalidDappParams } from "../../dappConnections/defineDappMethod.js";
import { RpcOutcomeUnknownError } from "../../dappConnections/errors.js";
import type { BroadcastEip155RawTransaction } from "./broadcastRawTransaction.js";
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

export const createEip155SendRawTransactionMethod = (
  broadcastRawTransaction: BroadcastEip155RawTransaction,
): DappRequestMethod =>
  defineDappMethod({
    decode: decodeSendRawTransactionParams,
    execute: async ({ chainRef, params: rawTransaction }) => {
      try {
        return await broadcastRawTransaction({ chainRef, rawTransaction });
      } catch (error) {
        if (error instanceof ChainJsonRpcHttpTransportError) {
          throw new RpcOutcomeUnknownError({ message: "Transaction broadcast outcome is unknown." });
        }
        throw error;
      }
    },
  });
