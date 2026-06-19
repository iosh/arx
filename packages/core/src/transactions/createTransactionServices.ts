import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { TransactionAggregateStore } from "./aggregate/index.js";
import { TransactionApprovalSessionService } from "./approval/TransactionApprovalSessionService.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { notifyTransactionChanges } from "./notifyTransactionChanges.js";
import { TransactionRecoveryService } from "./recovery/TransactionRecoveryService.js";
import { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import { TransactionInvalidations } from "./TransactionInvalidations.js";
import { TransactionResourceLock } from "./TransactionResourceLock.js";
import { TransactionsService } from "./TransactionsService.js";
import { SubmittedTransactionMonitor } from "./tracking/SubmittedTransactionMonitor.js";
import { SubmittedTransactionTracker } from "./tracking/SubmittedTransactionTracker.js";

type CreateApprovalSessionOptions = {
  now?: () => number;
  createId?: () => string;
};

type CreateTransactionServicesOptions = {
  aggregateStore: TransactionAggregateStore;
  namespaces: NamespaceTransactions;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  approvalSessionOptions?: CreateApprovalSessionOptions;
  resourceLock?: TransactionResourceLock;
};

export type TransactionServices = {
  transactions: TransactionsService;
  approvals: TransactionApprovalSessionService;
  submission: TransactionSubmissionExecutor;
  tracker: SubmittedTransactionTracker;
  monitor: SubmittedTransactionMonitor;
  recovery: TransactionRecoveryService;
};

export const createTransactionServices = (options: CreateTransactionServicesOptions): TransactionServices => {
  const resourceLock = options.resourceLock ?? new TransactionResourceLock();
  const invalidations = new TransactionInvalidations();
  const transactionsStore = notifyTransactionChanges(options.aggregateStore, invalidations);
  const approvals = new TransactionApprovalSessionService({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    resourceLock,
    ...options.approvalSessionOptions,
  });
  const submission = new TransactionSubmissionExecutor({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
  });
  const transactions = new TransactionsService({
    aggregateStore: transactionsStore,
    approvalSessions: approvals,
    submission,
    accountCodecs: options.accountCodecs,
    invalidations,
  });

  const tracker = new SubmittedTransactionTracker({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
  });
  const monitor = new SubmittedTransactionMonitor({
    transactions: transactionsStore,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
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
    approvals,
    submission,
    tracker,
    monitor,
    recovery,
  };
};
