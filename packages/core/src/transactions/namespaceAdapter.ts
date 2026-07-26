import type { Namespace } from "../namespaces/types.js";
import { TransactionNamespaceUnsupportedError } from "./errors.js";
import type { PendingTransactionRecord } from "./persistence.js";
import type { PreparedTransaction, PrepareTransactionInput } from "./preparedTransaction.js";
import type {
  SignedTransaction,
  TerminalTransactionState,
  Transaction,
  TransactionBroadcastOutcome,
  TransactionId,
  TransactionReplacementType,
  TransactionSigningInput,
  TransactionSubmission,
} from "./types.js";

export type TerminalTransactionChange = Readonly<{
  transactionId: TransactionId;
  state: TerminalTransactionState;
}>;

export type PendingTransactionInspection =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{
      status: "checked";
      terminalChanges: readonly TerminalTransactionChange[];
    }>;

export type TransactionsNamespaceAdapter = Readonly<{
  namespace: Namespace;
  prepare(input: { request: PrepareTransactionInput; from: string }): Promise<PreparedTransaction>;
  /** Adapters without replacement support must reject explicitly instead of returning an unchanged transaction. */
  prepareReplacement(input: {
    target: Transaction;
    type: TransactionReplacementType;
    from: string;
  }): Promise<Omit<PreparedTransaction, "initiator" | "replacesTransactionId">>;
  withSigningInput<T>(prepared: PreparedTransaction, use: (input: TransactionSigningInput) => Promise<T>): Promise<T>;
  sign(input: TransactionSigningInput): Promise<SignedTransaction>;
  broadcast(signed: SignedTransaction): Promise<TransactionBroadcastOutcome>;
  createSubmission(input: { transaction: Transaction; broadcast: TransactionBroadcastOutcome }): TransactionSubmission;
  inspectPending(records: readonly PendingTransactionRecord[]): Promise<PendingTransactionInspection>;
  recoverPending(
    records: readonly PendingTransactionRecord[],
    recoveryTransactionIds: readonly TransactionId[],
  ): Promise<PendingTransactionInspection>;
}>;

export type TransactionsNamespaceAdapters = Readonly<Record<Namespace, TransactionsNamespaceAdapter | undefined>>;

export const getTransactionsNamespaceAdapter = (
  adapters: TransactionsNamespaceAdapters,
  namespace: Namespace,
): TransactionsNamespaceAdapter => {
  const adapter = adapters[namespace];
  if (!adapter) throw new TransactionNamespaceUnsupportedError(namespace);
  return adapter;
};
