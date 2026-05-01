import type { TransactionController } from "../../controllers/transaction/types.js";
import type { WalletTransactions } from "../types.js";

export const createWalletTransactions = (deps: { transactions: TransactionController }): WalletTransactions => {
  const { transactions } = deps;

  return {
    getView: (id) => transactions.getView(id),
    beginTransactionApproval: (request, requestContext, options) =>
      transactions.beginTransactionApproval(request, requestContext, options),
    waitForTransactionSubmission: (id) => transactions.waitForTransactionSubmission(id),
    approveTransaction: (id) => transactions.approveTransaction(id),
    rejectTransaction: (id, reason) => transactions.rejectTransaction(id, reason),
    onStatusChanged: (handler) => transactions.onStatusChanged(handler),
    onStateChanged: (handler) => transactions.onStateChanged(handler),
  };
};
