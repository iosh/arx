import * as Hex from "ox/Hex";
import { z } from "zod";
import { ChainJsonRpcHttpTransportError } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import { type DappRequestMethod, defineDappMethod } from "../../dappConnections/defineDappMethod.js";
import { RpcOutcomeUnknownError } from "../../dappConnections/errors.js";
import type { BroadcastEip155RawTransaction } from "./broadcastRawTransaction.js";

const sendRawTransactionParams = z.tuple([
  z
    .string()
    .toLowerCase()
    .refine(
      (value) => value !== "0x" && Hex.validate(value, { strict: true, even: true }),
      "Expected non-empty hexadecimal transaction bytes with a 0x prefix.",
    )
    .transform((value) => value as Hex.Hex),
]);

export const createEip155SendRawTransactionMethod = (
  broadcastRawTransaction: BroadcastEip155RawTransaction,
): DappRequestMethod =>
  defineDappMethod({
    decode: (params) => sendRawTransactionParams.parse(params)[0],
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
