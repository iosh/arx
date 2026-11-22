import * as AccessList from "ox/AccessList";
import type { Address } from "ox/Address";
import type { Hex } from "ox/Hex";
import * as TxEnvelopeEip1559 from "ox/TxEnvelopeEip1559";
import * as TxEnvelopeEip2930 from "ox/TxEnvelopeEip2930";
import * as TxEnvelopeLegacy from "ox/TxEnvelopeLegacy";
import { isArxBaseError } from "../../errors.js";
import { assertEip155ChainId, chainIdFromChainRef } from "../../namespaces/eip155/chainId.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { Eip155TransactionInvalidError } from "./errors.js";
import type * as Eip155 from "./types.js";

type LegacyEnvelopeTransaction = Omit<Eip155.LegacyPreparedTransaction, "gas"> & Readonly<{ gas?: Hex | undefined }>;
type Eip2930EnvelopeTransaction = Omit<Eip155.Eip2930PreparedTransaction, "gas"> & Readonly<{ gas?: Hex | undefined }>;
type Eip1559EnvelopeTransaction = Omit<Eip155.Eip1559PreparedTransaction, "gas"> & Readonly<{ gas?: Hex | undefined }>;

type EnvelopeTransaction = LegacyEnvelopeTransaction | Eip2930EnvelopeTransaction | Eip1559EnvelopeTransaction;

const validateAccessList = (accessList: AccessList.AccessList): void => {
  // Ox envelope assertions do not check access-list storage key widths.
  AccessList.toTupleList(accessList);
};

export const createEip155TransactionEnvelope = (chainRef: ChainRef, transaction: EnvelopeTransaction) => {
  try {
    const chainId = chainIdFromChainRef(chainRef);
    // Persisted chain references can predate the current signing limit.
    assertEip155ChainId(chainId);
    const fields = {
      chainId: Number(chainId),
      ...(transaction.nonce === undefined ? {} : { nonce: BigInt(transaction.nonce) }),
      ...(transaction.gas === undefined ? {} : { gas: BigInt(transaction.gas) }),
      to: transaction.to === null ? null : (transaction.to as Address),
      value: BigInt(transaction.value),
      data: transaction.data,
    };

    switch (transaction.type) {
      case "legacy":
        return {
          type: "legacy" as const,
          envelope: TxEnvelopeLegacy.from({
            ...fields,
            gasPrice: BigInt(transaction.gasPrice),
          }),
        };
      case "eip2930":
        validateAccessList(transaction.accessList);
        return {
          type: "eip2930" as const,
          envelope: TxEnvelopeEip2930.from({
            ...fields,
            gasPrice: BigInt(transaction.gasPrice),
            accessList: transaction.accessList,
          }),
        };
      case "eip1559":
        validateAccessList(transaction.accessList);
        return {
          type: "eip1559" as const,
          envelope: TxEnvelopeEip1559.from({
            ...fields,
            maxFeePerGas: BigInt(transaction.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
            accessList: transaction.accessList,
          }),
        };
    }
  } catch (cause) {
    if (isArxBaseError(cause)) throw cause;
    throw new Eip155TransactionInvalidError({
      chainRef,
      type: transaction.type,
      cause,
    });
  }
};
