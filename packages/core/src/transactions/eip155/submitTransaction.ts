import * as Hash from "ox/Hash";
import * as HexValue from "ox/Hex";
import * as TxEnvelope from "ox/TxEnvelope";
import { ChainJsonRpcResponseError } from "../../chainJsonRpc/errors.js";
import { ChainJsonRpcHttpTransportError } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import { isArxBaseError } from "../../errors.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import type { BroadcastEip155RawTransaction } from "../../namespaces/eip155/broadcastRawTransaction.js";
import { isAccountSigningUnavailableError } from "../../wallet/accountKeys.js";
import { Eip155TransactionSigningError, Eip155TransactionSigningUnavailableError } from "./errors.js";
import { createEip155TransactionEnvelope } from "./transactionEnvelope.js";
import type * as Eip155 from "./types.js";

export type Eip155TransactionSubmitter = Readonly<{
  sign(input: Eip155.SigningInput): Promise<Eip155.SignedTransaction>;
  broadcast(signed: Eip155.SignedTransaction): Promise<Eip155.BroadcastOutcome>;
}>;

const signEip155Transaction = async (
  input: Eip155.SigningInput,
  signing: Eip155AccountSigning,
): Promise<Eip155.SignedTransaction> => {
  try {
    const transaction = input.transaction;
    const envelope = createEip155TransactionEnvelope(input.chainRef, transaction);
    const { r, s, yParity } = await signing.signDigest({
      accountId: input.accountId,
      digest: HexValue.toBytes(TxEnvelope.getSignPayload(envelope)),
    });
    const rawTransaction = TxEnvelope.serialize(envelope, {
      signature: { r: HexValue.fromNumber(r, { size: 32 }), s: HexValue.fromNumber(s, { size: 32 }), yParity },
    });

    return {
      chainRef: input.chainRef,
      hash: Hash.keccak256(rawTransaction),
      transaction,
      recovery: { rawTransaction },
    };
  } catch (cause) {
    if (isAccountSigningUnavailableError(cause)) {
      throw new Eip155TransactionSigningUnavailableError(input.chainRef, cause);
    }
    if (isArxBaseError(cause)) throw cause;
    throw new Eip155TransactionSigningError(input.chainRef, cause);
  }
};

export const createEip155TransactionSubmitter = (params: {
  broadcastRawTransaction: BroadcastEip155RawTransaction;
  signing: Eip155AccountSigning;
}): Eip155TransactionSubmitter => ({
  sign: (input) => signEip155Transaction(input, params.signing),

  async broadcast(signed) {
    try {
      await params.broadcastRawTransaction({
        chainRef: signed.chainRef,
        rawTransaction: signed.recovery.rawTransaction,
      });

      return { status: "pending" };
    } catch (error) {
      if (error instanceof ChainJsonRpcHttpTransportError) {
        return { status: "pending" };
      }
      if (error instanceof ChainJsonRpcResponseError) {
        if (error.rpcCode === -32000 && error.message.toLowerCase().trim() === "already known") {
          return { status: "pending" };
        }
        return {
          status: "rejected",
          failure: {
            type: "broadcast",
            code: error.rpcCode,
            message: error.message,
            ...(error.rpcData === undefined ? {} : { data: error.rpcData }),
          },
        };
      }
      throw error;
    }
  },
});
