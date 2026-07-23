import * as Hash from "ox/Hash";
import type { Hex } from "ox/Hex";
import * as HexValue from "ox/Hex";
import * as TransactionEnvelopeEip1559 from "ox/TransactionEnvelopeEip1559";
import * as TransactionEnvelopeLegacy from "ox/TransactionEnvelopeLegacy";
import type { AccountId } from "../../accounts/accountId.js";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError } from "../../chainJsonRpc/errors.js";
import { isArxBaseError } from "../../errors.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import { chainIdFromChainRef } from "../../namespaces/eip155/chainId.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { Eip155TransactionSigningError } from "./errors.js";
import type * as Eip155 from "./types.js";

export type Eip155TransactionSubmitter = Readonly<{
  createSigningInput(input: {
    chainRef: ChainRef;
    accountId: AccountId;
    transaction: Eip155.PreparedTransaction;
  }): Promise<Eip155.SigningInput>;
  sign(input: Eip155.SigningInput): Promise<Eip155.SignedTransaction>;
  broadcast(signed: Eip155.SignedTransaction): Promise<Eip155.BroadcastOutcome>;
}>;

const signEip155Transaction = async (
  input: Eip155.SigningInput,
  signing: Eip155AccountSigning,
): Promise<Eip155.SignedTransaction> => {
  try {
    const { transaction } = input;
    const chainId = Number(chainIdFromChainRef(input.chainRef));
    const envelope = {
      chainId,
      nonce: BigInt(transaction.nonce),
      gas: BigInt(transaction.gas),
      to: transaction.to === null ? null : (transaction.to as Hex),
      value: BigInt(transaction.value),
      data: transaction.data,
    };

    let rawTransaction: Hex;
    if (transaction.fee.type === "legacy") {
      const legacy = {
        ...envelope,
        type: "legacy" as const,
        gasPrice: BigInt(transaction.fee.gasPrice),
      };
      const signature = await signing.signDigest({
        accountId: input.accountId,
        digest: HexValue.toBytes(TransactionEnvelopeLegacy.getSignPayload(legacy)),
      });
      rawTransaction = TransactionEnvelopeLegacy.serialize(legacy, { signature });
    } else {
      const eip1559 = {
        ...envelope,
        type: "eip1559" as const,
        maxFeePerGas: BigInt(transaction.fee.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(transaction.fee.maxPriorityFeePerGas),
      };
      const signature = await signing.signDigest({
        accountId: input.accountId,
        digest: HexValue.toBytes(TransactionEnvelopeEip1559.getSignPayload(eip1559)),
      });
      rawTransaction = TransactionEnvelopeEip1559.serialize(eip1559, { signature });
    }

    return {
      chainRef: input.chainRef,
      transaction,
      recovery: { rawTransaction },
    };
  } catch (cause) {
    if (isArxBaseError(cause)) throw cause;
    throw new Eip155TransactionSigningError(input.chainRef, cause);
  }
};

export const createEip155TransactionSubmitter = (params: {
  chainJsonRpc: ChainJsonRpc;
  signing: Eip155AccountSigning;
}): Eip155TransactionSubmitter => ({
  async createSigningInput(input) {
    const nonce =
      input.transaction.nonce ??
      (await params.chainJsonRpc.request<Hex>({
        chainRef: input.chainRef,
        method: "eth_getTransactionCount",
        params: [input.transaction.from, "pending"],
        replay: "allowed",
      }));

    return {
      chainRef: input.chainRef,
      accountId: input.accountId,
      transaction: { ...input.transaction, nonce },
    };
  },

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
