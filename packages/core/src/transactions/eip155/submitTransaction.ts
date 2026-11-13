import * as Hash from "ox/Hash";
import type { Hex } from "ox/Hex";
import * as HexValue from "ox/Hex";
import * as TxEnvelopeEip1559 from "ox/TxEnvelopeEip1559";
import * as TxEnvelopeEip2930 from "ox/TxEnvelopeEip2930";
import * as TxEnvelopeLegacy from "ox/TxEnvelopeLegacy";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError } from "../../chainJsonRpc/errors.js";
import { isArxBaseError } from "../../errors.js";
import { type Eip155AccountSigning, isAccountSigningUnavailableError } from "../../namespaces/eip155/accountSigning.js";
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
    const transactionEnvelope = createEip155TransactionEnvelope(input.chainRef, transaction);
    const signPayload = async (payload: Hex) => {
      const signature = await signing.signDigest({
        accountId: input.accountId,
        digest: HexValue.toBytes(payload),
      });
      return {
        r: HexValue.fromNumber(signature.r, { size: 32 }),
        s: HexValue.fromNumber(signature.s, { size: 32 }),
        yParity: signature.yParity,
      };
    };

    let rawTransaction: Hex;
    switch (transactionEnvelope.type) {
      case "legacy": {
        const envelope = transactionEnvelope.envelope;
        const signature = await signPayload(TxEnvelopeLegacy.getSignPayload(envelope));
        rawTransaction = TxEnvelopeLegacy.serialize(envelope, { signature });
        break;
      }
      case "eip2930": {
        const envelope = transactionEnvelope.envelope;
        const signature = await signPayload(TxEnvelopeEip2930.getSignPayload(envelope));
        rawTransaction = TxEnvelopeEip2930.serialize(envelope, { signature });
        break;
      }
      case "eip1559": {
        const envelope = transactionEnvelope.envelope;
        const signature = await signPayload(TxEnvelopeEip1559.getSignPayload(envelope));
        rawTransaction = TxEnvelopeEip1559.serialize(envelope, { signature });
        break;
      }
    }

    return {
      chainRef: input.chainRef,
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
  chainJsonRpc: ChainJsonRpc;
  signing: Eip155AccountSigning;
}): Eip155TransactionSubmitter => ({
  sign: (input) => signEip155Transaction(input, params.signing),

  async broadcast(signed) {
    try {
      const transactionHash = await params.chainJsonRpc.request<Hex>({
        chainRef: signed.chainRef,
        method: "eth_sendRawTransaction",
        params: [signed.recovery.rawTransaction],
        replay: "forbidden",
      });

      return { status: "accepted", transactionHash };
    } catch (error) {
      if (error instanceof ChainJsonRpcOutcomeUnknownError) {
        return {
          status: "unknown",
          transactionHash: Hash.keccak256(signed.recovery.rawTransaction),
        };
      }
      if (error instanceof ChainJsonRpcResponseError) {
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
