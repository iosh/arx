import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

export const transactionsMethods = {
  "ui.transactions.requestSendTransactionApproval": defineMethod(
    "command",
    z.strictObject({
      to: z.string().min(1),
      valueEther: z.string().min(1),
      chainRef: ChainRefSchema.optional(),
    }),
    z.strictObject({
      approvalId: z.string().uuid(),
    }),
    { broadcastSnapshot: true },
  ),
  "ui.transactions.retryPrepare": defineMethod(
    "command",
    z.strictObject({
      transactionId: z.string().min(1),
    }),
    z.null(),
    { broadcastSnapshot: false },
  ),
  "ui.transactions.applyDraftEdit": defineMethod(
    "command",
    z.strictObject({
      transactionId: z.string().min(1),
      changes: z.array(z.record(z.string(), z.unknown())),
      mode: z.string().min(1).optional(),
    }),
    z.null(),
    { broadcastSnapshot: false },
  ),
} as const;
