import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const transactionsMethods = {
  "ui.transactions.listHistory": defineMethod("query", WalletApiSchemas.transactions.listHistory),
  "ui.transactions.getDetail": defineMethod("query", WalletApiSchemas.transactions.getDetail),
  "ui.transactions.requestSendTransactionApproval": defineMethod(
    "command",
    WalletApiSchemas.transactions.requestSendTransactionApproval,
  ),
  "ui.transactions.rerunPrepare": defineMethod("command", WalletApiSchemas.transactions.rerunPrepare),
  "ui.transactions.applyDraftEdit": defineMethod("command", WalletApiSchemas.transactions.applyDraftEdit),
} as const;
