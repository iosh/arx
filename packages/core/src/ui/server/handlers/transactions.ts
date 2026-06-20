import type { CoreReadApi } from "../../../read/types.js";
import type { ListTransactionsQuery } from "../../../transactions/TransactionsService.js";
import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { ListTransactionsQuery as UiListTransactionsQuery } from "../../protocol/models/transactions.js";
import type { UiHandlers } from "../types.js";

export const createTransactionsHandlers = (deps: {
  wallet: TrustedWalletApi;
  read: CoreReadApi;
}): Pick<
  UiHandlers,
  | "ui.transactions.listHistory"
  | "ui.transactions.getDetail"
  | "ui.transactions.requestSendTransactionApproval"
  | "ui.transactions.rerunPrepare"
  | "ui.transactions.applyDraftEdit"
> => {
  return {
    "ui.transactions.listHistory": async (input: UiListTransactionsQuery) => {
      if (input === undefined) {
        return await deps.read.listTransactions();
      }

      const query: ListTransactionsQuery = {};
      if (input.namespace !== undefined) {
        query.namespace = input.namespace;
      }
      if (input.chainRef !== undefined) {
        query.chainRef = input.chainRef;
      }
      if (input.accountKey !== undefined) {
        query.accountKey = input.accountKey;
      }
      if (input.status !== undefined) {
        query.status = input.status;
      }
      if (input.limit !== undefined) {
        query.limit = input.limit;
      }
      if (input.before !== undefined) {
        query.before = input.before;
      }

      return await deps.read.listTransactions(query);
    },
    "ui.transactions.getDetail": async (input) => await deps.read.getTransactionDetail(input),
    "ui.transactions.requestSendTransactionApproval": async (input) =>
      await deps.wallet.requestSendTransactionApproval(input),
    "ui.transactions.rerunPrepare": async (input) => await deps.wallet.rerunTransactionPrepare(input),
    "ui.transactions.applyDraftEdit": async (input) => await deps.wallet.applyTransactionDraftEdit(input),
  };
};
