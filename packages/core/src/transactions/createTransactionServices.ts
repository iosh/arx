import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { TransactionAggregateStore } from "./aggregate/index.js";
import { TransactionApprovalSessionService } from "./approval/TransactionApprovalSessionService.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { TransactionRecoveryService } from "./recovery/TransactionRecoveryService.js";
import { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import { TransactionResourceLock } from "./TransactionResourceLock.js";
import { TransactionsService } from "./TransactionsService.js";
import { SubmittedTransactionTrackingService } from "./tracking/SubmittedTransactionTrackingService.js";

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
  tracking: SubmittedTransactionTrackingService;
  recovery: TransactionRecoveryService;
};

export const createTransactionServices = (options: CreateTransactionServicesOptions): TransactionServices => {
  const resourceLock = options.resourceLock ?? new TransactionResourceLock();
  const approvals = new TransactionApprovalSessionService({
    transactions: options.aggregateStore,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
    ...options.approvalSessionOptions,
  });
  const transactions = new TransactionsService({
    aggregateStore: options.aggregateStore,
    approvalSessions: approvals,
    accountCodecs: options.accountCodecs,
  });

  const submission = new TransactionSubmissionExecutor({
    transactions: options.aggregateStore,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
  });

  const tracking = new SubmittedTransactionTrackingService({
    transactions: options.aggregateStore,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
  });

  const recovery = new TransactionRecoveryService({
    transactions: options.aggregateStore,
    tracking,
  });

  return {
    transactions,
    approvals,
    submission,
    tracking,
    recovery,
  };
};
