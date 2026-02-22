import type { TransactionStatus } from "../../storage/records.js";

const ALLOWED: Record<TransactionStatus, ReadonlySet<TransactionStatus>> = {
  pending: new Set(["approved", "failed"]),
  approved: new Set(["signed", "failed"]),
  signed: new Set(["broadcast", "failed"]),
  broadcast: new Set(["confirmed", "failed", "replaced"]),
  confirmed: new Set([]),
  failed: new Set([]),
  replaced: new Set([]),
};

export const canTransitionTransactionStatus = (from: TransactionStatus, to: TransactionStatus) => {
  return ALLOWED[from].has(to);
};

export const assertTransactionStatusTransition = (from: TransactionStatus, to: TransactionStatus) => {
  if (canTransitionTransactionStatus(from, to)) return;
  throw new Error(`Invalid transaction status transition: ${from} -> ${to}`);
};
