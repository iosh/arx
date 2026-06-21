import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const transactionsMethods = {
  "ui.transactions.listHistory": defineMethod("query", WalletApiSchemas.transactions.listHistory, {
    broadcastSnapshot: false,
  }),
  "ui.transactions.getDetail": defineMethod("query", WalletApiSchemas.transactions.getDetail, {
    broadcastSnapshot: false,
  }),
  "ui.transactions.requestSendTransactionApproval": defineMethod(
    "command",
    WalletApiSchemas.transactions.requestSendTransactionApproval,
    { broadcastSnapshot: true },
  ),
  "ui.transactions.rerunPrepare": defineMethod("command", WalletApiSchemas.transactions.rerunPrepare, {
    broadcastSnapshot: false,
  }),
  "ui.transactions.applyDraftEdit": defineMethod("command", WalletApiSchemas.transactions.applyDraftEdit, {
    broadcastSnapshot: false,
  }),
} as const;
