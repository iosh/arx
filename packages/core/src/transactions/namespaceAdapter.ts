import type { Hex } from "ox/Hex";
import type { Namespace } from "../namespaces/types.js";
import type { PreparedTransaction, PrepareTransactionInput } from "./preparedTransaction.js";
import type {
  SignedTransaction,
  Transaction,
  TransactionBroadcastOutcome,
  TransactionReplacementType,
  TransactionSigningInput,
  TransactionSubmission,
} from "./types.js";

export type TransactionsNamespaceAdapter = Readonly<{
  namespace: Namespace;
  prepare(input: { request: PrepareTransactionInput; from: string }): Promise<PreparedTransaction>;
  /** Adapters without replacement support must reject explicitly instead of returning an unchanged transaction. */
  prepareReplacement(input: {
    target: Transaction;
    type: TransactionReplacementType;
  }): Promise<Omit<PreparedTransaction, "initiator" | "replacesTransactionId" | "replacementType">>;
  withSigningInput<T>(
    prepared: PreparedTransaction,
    use: (input: TransactionSigningInput) => Promise<T>,
    replacement?: Readonly<{ target: Transaction; type: TransactionReplacementType }>,
  ): Promise<T>;
  sign(input: TransactionSigningInput): Promise<SignedTransaction>;
  broadcast(signed: SignedTransaction): Promise<TransactionBroadcastOutcome>;
  createSubmission(input: {
    transaction: Transaction;
    broadcast: TransactionBroadcastOutcome;
    transactionHash: Hex;
  }): TransactionSubmission;
}>;

export type TransactionsNamespaceAdapters = Readonly<Record<Namespace, TransactionsNamespaceAdapter>>;
