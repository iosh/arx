import type { TransactionStatus } from "./types.js";

export const TERMINAL_TRANSACTION_STATUSES = new Set<TransactionStatus>(["confirmed", "failed", "replaced"]);

export const EXECUTABLE_TRANSACTION_STATUSES = new Set<TransactionStatus>(["approved", "signed"]);

export const PREPARE_ELIGIBLE_TRANSACTION_STATUSES = new Set<TransactionStatus>(["pending", "approved", "signed"]);

export const isTerminalTransactionStatus = (status: TransactionStatus): boolean =>
  TERMINAL_TRANSACTION_STATUSES.has(status);

export const isExecutableTransactionStatus = (status: TransactionStatus): boolean =>
  EXECUTABLE_TRANSACTION_STATUSES.has(status);

export const isPrepareEligibleTransactionStatus = (status: TransactionStatus): boolean =>
  PREPARE_ELIGIBLE_TRANSACTION_STATUSES.has(status);
