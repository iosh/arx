import type { Namespace } from "../namespaces/types.js";
import { TransactionNamespaceUnsupportedError } from "./errors.js";
import type { PreparedTransaction, PrepareTransactionInput } from "./preparedTransaction.js";
import type {
  SignedTransaction,
  Transaction,
  TransactionBroadcastOutcome,
  TransactionSigningInput,
  TransactionSubmission,
} from "./types.js";

export type TransactionsNamespaceAdapter = Readonly<{
  namespace: Namespace;
  prepare(input: { request: PrepareTransactionInput; from: string }): Promise<PreparedTransaction>;
  createSigningInput(prepared: PreparedTransaction): Promise<TransactionSigningInput>;
  sign(input: TransactionSigningInput): Promise<SignedTransaction>;
  broadcast(signed: SignedTransaction): Promise<TransactionBroadcastOutcome>;
  createSubmission(input: { transaction: Transaction; broadcast: TransactionBroadcastOutcome }): TransactionSubmission;
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
