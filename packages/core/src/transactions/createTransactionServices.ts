import type { AccountAddressingByNamespace } from "../accounts/addressing/addressing.js";
import type { Messenger } from "../messenger/index.js";
import type { TransactionAggregateStore } from "./aggregate/index.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { notifyTransactionChanges } from "./notifyTransactionChanges.js";
import { TransactionRecoveryService } from "./recovery/TransactionRecoveryService.js";
import { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import { TransactionInvalidations } from "./TransactionInvalidations.js";
import { TransactionResourceLock } from "./TransactionResourceLock.js";
import { TransactionsService } from "./TransactionsService.js";
import { SubmittedTransactionMonitor } from "./tracking/SubmittedTransactionMonitor.js";
import { SubmittedTransactionTracker } from "./tracking/SubmittedTransactionTracker.js";

type CreateTransactionServicesOptions = {
  aggregateStore: TransactionAggregateStore;
  namespaces: NamespaceTransactions;
  accountAddressing: AccountAddressingByNamespace;
  resourceLock?: TransactionResourceLock;
  messenger?: Messenger;
  now?: () => number;
  createId?: () => string;
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
  const invalidations = new TransactionInvalidations(options.messenger);
  const transactionsStore = notifyTransactionChanges(options.aggregateStore, invalidations);
  const submission = new TransactionSubmissionExecutor({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accountAddressing: options.accountAddressing,
    resourceLock,
  });
  const transactionServiceDeps: ConstructorParameters<typeof TransactionsService>[0] = {
    aggregateStore: transactionsStore,
    namespaces: options.namespaces,
    submission,
    accountAddressing: options.accountAddressing,
    resourceLock,
    invalidations,
  };
  if (options.now !== undefined) {
    transactionServiceDeps.now = options.now;
  }
  if (options.createId !== undefined) {
    transactionServiceDeps.createId = options.createId;
  }
  const transactions = new TransactionsService(transactionServiceDeps);

  const tracker = new SubmittedTransactionTracker({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accountAddressing: options.accountAddressing,
    resourceLock,
  });
  const monitor = new SubmittedTransactionMonitor({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accountAddressing: options.accountAddressing,
    tracker,
  });
  invalidations.onTransactionsChanged((transactionIds) => {
    void monitor.refresh({ transactionIds }).catch(() => {
      // Explicit refresh/runDue calls surface monitor errors; invalidation must not create unhandled rejections.
    });
  });

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
