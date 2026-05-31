import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { TransactionAggregateStore } from "./aggregate/index.js";
import type { TransactionApprovalSessionService } from "./approval/TransactionApprovalSessionService.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { TransactionRecoveryService } from "./recovery/TransactionRecoveryService.js";
import { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import { SubmittedTransactionTrackingService } from "./tracking/SubmittedTransactionTrackingService.js";

type CreateTransactionServicesOptions = {
  transactions: TransactionAggregateStore;
  approvals: TransactionApprovalSessionService;
  namespaces: NamespaceTransactions;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
};

export type TransactionServices = {
  approvals: TransactionApprovalSessionService;
  submission: TransactionSubmissionExecutor;
  tracking: SubmittedTransactionTrackingService;
  recovery: TransactionRecoveryService;
};

export const createTransactionServices = (options: CreateTransactionServicesOptions): TransactionServices => {
  const submission = new TransactionSubmissionExecutor({
    transactions: options.transactions,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
  });

  const tracking = new SubmittedTransactionTrackingService({
    transactions: options.transactions,
    namespaces: options.namespaces,
    accountCodecs: options.accountCodecs,
  });

  const recovery = new TransactionRecoveryService({
    transactions: options.transactions,
    tracking,
  });

  return {
    approvals: options.approvals,
    submission,
    tracking,
    recovery,
  };
};
