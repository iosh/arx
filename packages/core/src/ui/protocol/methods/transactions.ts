import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { ListTransactionsQuerySchema } from "../models/transactions.js";
import { defineMethod } from "./types.js";

const Eip155TransactionDraftChangeSchema = z.strictObject({
  field: z.enum(["gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]),
  value: z.string().min(1).nullable(),
});

const NamespaceTransactionDraftEditSchema = z.discriminatedUnion("namespace", [
  z.strictObject({
    namespace: z.literal("eip155"),
    changes: z.array(Eip155TransactionDraftChangeSchema),
  }),
]);

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
    z.strictObject({
      to: z.string().min(1),
      valueEther: z.string().min(1),
      chainRef: ChainRefSchema.optional(),
    }),
    { broadcastSnapshot: true },
  ),
  "ui.transactions.rerunPrepare": defineMethod(
    "command",
    z.strictObject({
      transactionId: z.string().min(1),
    }),
    { broadcastSnapshot: false },
  ),
  "ui.transactions.applyDraftEdit": defineMethod(
    "command",
    z.strictObject({
      transactionId: z.string().min(1),
      edit: NamespaceTransactionDraftEditSchema,
      mode: z.string().min(1).optional(),
    }),
    { broadcastSnapshot: false },
  ),
} as const;
