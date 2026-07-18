import type { Accounts } from "../accounts/Accounts.js";
import type { Messenger } from "../messenger/index.js";
import type { TransactionAggregateStore } from "./aggregate/index.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { notifyTransactionChanges } from "./notifyTransactionChanges.js";
import { TransactionRecoveryService } from "./recovery/TransactionRecoveryService.js";
import { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import { TransactionChangePublisher } from "./TransactionChangePublisher.js";
import { TransactionResourceLock } from "./TransactionResourceLock.js";
import { TransactionsService } from "./TransactionsService.js";
import { SubmittedTransactionMonitor } from "./tracking/SubmittedTransactionMonitor.js";
import { SubmittedTransactionTracker } from "./tracking/SubmittedTransactionTracker.js";

type CreateTransactionServicesOptions = {
  aggregateStore: TransactionAggregateStore;
  namespaces: NamespaceTransactions;
  accounts: Pick<Accounts, "getAddress">;
  resourceLock?: TransactionResourceLock;
  messenger?: Messenger;
};

export type TransactionServices = {
  transactions: TransactionsService;
  submission: TransactionSubmissionExecutor;
  tracker: SubmittedTransactionTracker;
  monitor: SubmittedTransactionMonitor;
  recovery: TransactionRecoveryService;
};

export const createTransactionServices = (options: CreateTransactionServicesOptions): TransactionServices => {
  const resourceLock = options.resourceLock ?? new TransactionResourceLock();
  const transactionChanges = new TransactionChangePublisher(options.messenger);
  const transactionsStore = notifyTransactionChanges(options.aggregateStore, transactionChanges);
  const submission = new TransactionSubmissionExecutor({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accounts: options.accounts,
    resourceLock,
  });
  const transactions = new TransactionsService({
    aggregateStore: transactionsStore,
    namespaces: options.namespaces,
    submission,
    accounts: options.accounts,
    resourceLock,
    transactionChanges,
  });

  const tracker = new SubmittedTransactionTracker({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accounts: options.accounts,
    resourceLock,
  });
  const monitor = new SubmittedTransactionMonitor({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accounts: options.accounts,
    tracker,
  });
  transactionChanges.onTransactionRecordsCommitted((transactionIds) => monitor.refresh({ transactionIds }));

  const recovery = new TransactionRecoveryService({
    transactions: transactionsStore,
  });

  return {
    transactions,
    submission,
    tracker,
    monitor,
    recovery,
  };
};
