import { persistenceChange } from "../persistence/change.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type {
  SubmittedTransactionRecord,
  TransactionHistoryPage,
  TransactionHistoryQuery,
  TransactionJsonObject,
  TransactionRecord,
} from "./persistence.js";
import { transactionPersistenceType } from "./persistence.js";
import { TransactionRecordNotFoundError, TransactionReplacementTargetError } from "./recordErrors.js";
import { TransactionMonitor } from "./TransactionMonitor.js";
import { TransactionResourceQueue } from "./TransactionResourceQueue.js";
import type { TransactionsBootstrap } from "./transactionBootstrap.js";
import {
  getTransactionNamespaceAdapter,
  type TransactionNamespaceAdapters,
  type TransactionSubmissionInput,
} from "./transactionNamespace.js";
import { interruptTransaction } from "./transactionRecord.js";
import { submitTransaction } from "./transactionSubmission.js";

export type TransactionsChanged = Readonly<{
  transactionIds: readonly string[];
}>;

export type Transactions = Readonly<{
  get(transactionId: string): Promise<TransactionRecord | null>;
  list(query: TransactionHistoryQuery): Promise<TransactionHistoryPage>;
  submit(input: TransactionSubmissionInput): Promise<TransactionRecord>;
  createReplacementPayload(params: {
    transactionId: string;
    type: "speed-up" | "cancel";
  }): Promise<TransactionJsonObject>;
  monitor: TransactionMonitor;
}>;

export const createTransactions = async (params: {
  readers: Pick<CorePersistenceReaders, "transactions">;
  mutations: CoreMutationQueue;
  adapters: TransactionNamespaceAdapters;
  bootstrap: TransactionsBootstrap;
  /** Publishes committed transaction changes and must not throw. */
  publishChanged(change: TransactionsChanged): void;
}): Promise<Transactions> => {
  const interrupted = params.bootstrap.activeTransactions.filter(
    (record) => record.status === "submitting" || record.status === "broadcasting",
  );
  if (interrupted.length > 0) {
    await params.mutations.run(async (commit) => {
      await commit(
        interrupted.map((record) => persistenceChange.put(transactionPersistenceType, interruptTransaction(record))),
      );
    });
  }

  const monitor = new TransactionMonitor({
    readers: params.readers,
    mutations: params.mutations,
    adapters: params.adapters,
    publishChanged: (transactionIds) => params.publishChanged({ transactionIds }),
  });
  monitor.restore(
    params.bootstrap.activeTransactions.filter(
      (record): record is SubmittedTransactionRecord => record.status === "submitted",
    ),
  );
  const resources = new TransactionResourceQueue();

  return {
    get: (transactionId) => params.readers.transactions.get(transactionId),
    list: (query) => params.readers.transactions.listHistory(query),
    submit: (input) =>
      submitTransaction({
        readers: params.readers,
        mutations: params.mutations,
        adapters: params.adapters,
        resources,
        input,
        publishChanged: (transactionIds) => params.publishChanged({ transactionIds }),
        onSubmitted: (record) => monitor.track(record),
      }),
    createReplacementPayload: async ({ transactionId, type }) => {
      const target = await params.readers.transactions.get(transactionId);
      if (!target) throw new TransactionRecordNotFoundError(transactionId);
      if (target.status !== "submitted") {
        throw new TransactionReplacementTargetError({
          targetTransactionId: transactionId,
        });
      }
      return await getTransactionNamespaceAdapter(params.adapters, target.chainRef).createReplacementPayload({
        target,
        type,
      });
    },
    monitor,
  };
};
