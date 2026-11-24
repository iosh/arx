import { z } from "zod";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { type DappRequestMethod, defineDappMethod, invalidDappParams } from "../../dappConnections/defineDappMethod.js";
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
    execute: ({ chainRef, params }) =>
      chainJsonRpc.request({
        chainRef,
        method: "eth_sendRawTransaction",
        params: [params],
        replay: "forbidden",
      }),
  });
