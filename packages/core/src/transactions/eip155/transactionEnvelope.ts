import * as AccessList from "ox/AccessList";
import type { Hex } from "ox/Hex";
import * as TxEnvelope from "ox/TxEnvelope";
import { isArxBaseError } from "../../errors.js";
import { assertEip155ChainId, chainIdFromChainRef } from "../../namespaces/eip155/chainId.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { Eip155TransactionInvalidError } from "./errors.js";
import type * as Eip155 from "./types.js";

type EnvelopeNumbers = Readonly<{ gas?: Hex; nonce?: Hex }>;

type EnvelopeTransaction = EnvelopeNumbers &
  (
    | Omit<Eip155.LegacyPreparedTransaction, "gas">
    | Omit<Eip155.Eip2930PreparedTransaction, "gas">
    | Omit<Eip155.Eip1559PreparedTransaction, "gas">
  );

const validateAccessList = (accessList: AccessList.AccessList): void => {
  // Ox envelope assertions do not check access-list storage key widths.
  AccessList.toTupleList(accessList);
};

export const createEip155TransactionEnvelope = (
  chainRef: ChainRef,
  transaction: EnvelopeTransaction,
): TxEnvelope.TxEnvelope => {
  try {
    const chainId = chainIdFromChainRef(chainRef);
    // Persisted chain references can predate the current signing limit.
    assertEip155ChainId(chainId);
    const fields = {
      chainId: Number(chainId),
      ...(transaction.nonce === undefined ? {} : { nonce: BigInt(transaction.nonce) }),
      ...(transaction.gas === undefined ? {} : { gas: BigInt(transaction.gas) }),
      to: transaction.to,
      value: BigInt(transaction.value),
      data: transaction.data,
    };

    const fees =
      transaction.type === "eip1559"
        ? {
            maxFeePerGas: BigInt(transaction.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
          }
        : { gasPrice: BigInt(transaction.gasPrice) };
    if (transaction.type !== "legacy") validateAccessList(transaction.accessList);
    return TxEnvelope.from({
      ...fields,
      ...fees,
      type: transaction.type,
      ...(transaction.type === "legacy" ? {} : { accessList: transaction.accessList }),
    });
  } catch (cause) {
    if (isArxBaseError(cause)) throw cause;
    throw new Eip155TransactionInvalidError({
      chainRef,
      type: transaction.type,
      cause,
    });
  }
};
