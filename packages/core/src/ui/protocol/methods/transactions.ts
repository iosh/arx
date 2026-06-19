import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { ListTransactionsQuerySchema } from "../models/transactions.js";
import { defineMethod } from "./types.js";

export const transactionsMethods = {
  "ui.transactions.listHistory": defineMethod("query", ListTransactionsQuerySchema, {
    broadcastSnapshot: false,
  }),
  "ui.transactions.getDetail": defineMethod(
    "query",
    z.strictObject({
      transactionId: z.string().min(1),
    }),
    { broadcastSnapshot: false },
  ),
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
