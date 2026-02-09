import { z } from "zod";
import { defineMethod } from "./types.js";

const NativeBalanceResultSchema = z.strictObject({
  chainRef: z.string().min(1),
  address: z.string().min(1),
  amountWei: z.string().regex(/^\d+$/),
  fetchedAt: z.number().int(),
});

export const balancesMethods = {
  "ui.balances.getNative": defineMethod(
    z.strictObject({
      chainRef: z.string().min(1),
      address: z.string().min(1),
    }),
    NativeBalanceResultSchema,
  ),
} as const;
