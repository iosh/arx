import type { Hex } from "ox/Hex";
import type { TransactionConflictKey } from "../../aggregate/types.js";

/**
 * Durable JSON form of the EIP-155 fields that must be fixed before signing.
 *
 * The field names stay aligned with standard Ethereum transaction request
 * names. We keep hex strings instead of bigint/number so the payload can be
 * stored without further conversion.
 */
export type Eip155TransactionCoreFields = {
  chainId: Hex;
  from: Hex;
  to: Hex | null;
  value: Hex;
  data: Hex;
  gas: Hex;
  nonce: Hex;
};

/** Final legacy transaction approved for EIP-155 signing. */
export type Eip155UnsignedLegacyTransaction = Eip155TransactionCoreFields & {
  type: "legacy";
  gasPrice: Hex;
};

/** Final EIP-1559 transaction approved for EIP-155 signing. */
export type Eip155UnsignedEip1559Transaction = Eip155TransactionCoreFields & {
  type: "eip1559";
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
};

/** Final EIP-155 payload used for signing and durable approval storage. */
export type Eip155UnsignedTransaction = Eip155UnsignedLegacyTransaction | Eip155UnsignedEip1559Transaction;

export type Eip155PreparedLegacyTransaction = Omit<Eip155UnsignedLegacyTransaction, "nonce"> & {
  nonce?: Hex;
};

export type Eip155PreparedEip1559Transaction = Omit<Eip155UnsignedEip1559Transaction, "nonce"> & {
  nonce?: Hex;
};

/** Prepared review/submission proposal. Wallet-managed nonce may be absent until final submit. */
export type Eip155PreparedTransaction = Eip155PreparedLegacyTransaction | Eip155PreparedEip1559Transaction;

/**
 * Partial prepared transaction shown while gas, fees, or nonce are still
 * settling during review.
 */
export type Eip155UnsignedTransactionDraft = Partial<Omit<Eip155TransactionCoreFields, "to">> & {
  to?: Hex | null;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
};

/** Builds the durable nonce conflict key for one EIP-155 account on one chain. */
export const buildEip155TransactionConflictKey = ({
  chainRef,
  accountId,
  nonce,
}: {
  chainRef: string;
  accountId: string;
  nonce: Hex;
}): TransactionConflictKey => ({
  kind: "eip155.nonce",
  value: `${chainRef}:${accountId}:${nonce}`,
});
