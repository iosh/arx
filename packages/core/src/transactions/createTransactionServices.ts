import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { TransactionAggregateStore } from "./aggregate/index.js";
import { TransactionApprovalSessionService } from "./approval/TransactionApprovalSessionService.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { TransactionRecoveryService } from "./recovery/TransactionRecoveryService.js";
import { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import { TransactionResourceLock } from "./TransactionResourceLock.js";
import { SubmittedTransactionTrackingService } from "./tracking/SubmittedTransactionTrackingService.js";

type CreateApprovalSessionOptions = {
  now?: () => number;
  createId?: () => string;
};

type CreateTransactionServicesOptions = {
  transactions: TransactionAggregateStore;
  namespaces: NamespaceTransactions;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  approvalSessionOptions?: CreateApprovalSessionOptions;
  resourceLock?: TransactionResourceLock;
};

export type TransactionServices = {
  approvals: TransactionApprovalSessionService;
  submission: TransactionSubmissionExecutor;
  tracking: SubmittedTransactionTrackingService;
  recovery: TransactionRecoveryService;
};

export const createTransactionServices = (options: CreateTransactionServicesOptions): TransactionServices => {
  const resourceLock = options.resourceLock ?? new TransactionResourceLock();
  const approvals = new TransactionApprovalSessionService({
    transactions: options.transactions,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
    ...options.approvalSessionOptions,
  });

  const submission = new TransactionSubmissionExecutor({
    transactions: options.transactions,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
  });

  const tracking = new SubmittedTransactionTrackingService({
    transactions: options.transactions,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
    resourceLock,
  });

  const recovery = new TransactionRecoveryService({
    transactions: options.transactions,
    tracking,
  });

  return {
    approvals,
    submission,
    tracking,
    recovery,
  };
};
