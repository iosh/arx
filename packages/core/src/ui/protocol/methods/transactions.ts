import { z } from "zod";
import { defineMethod } from "./types.js";

export const transactionsMethods = {
  "ui.transactions.requestSendTransactionApproval": defineMethod(
    z.strictObject({
      to: z.string().min(1),
      valueEther: z.string().min(1),
      chainRef: z.string().min(1).optional(),
    }),
    z.strictObject({
      approvalId: z.string().uuid(),
    }),
    { broadcastSnapshot: true },
  ),
} as const;
