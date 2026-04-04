import type { TransactionController } from "../../controllers/transaction/types.js";
import type { WalletTransactions } from "../types.js";

export const createWalletTransactions = (deps: { transactions: TransactionController }): WalletTransactions => {
  const { transactions } = deps;

  return {
    getMeta: (id) => transactions.getMeta(id),
    beginTransactionApproval: (request, requestContext) =>
      transactions.beginTransactionApproval(request, requestContext),
    waitForTransactionSubmission: (id) => transactions.waitForTransactionSubmission(id),
    approveTransaction: (id) => transactions.approveTransaction(id),
    rejectTransaction: (id, reason) => transactions.rejectTransaction(id, reason),
    processTransaction: (id) => transactions.processTransaction(id),
    onStatusChanged: (handler) => transactions.onStatusChanged(handler),
    onStateChanged: (handler) => transactions.onStateChanged(handler),
  };
};
