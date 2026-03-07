import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

const NativeBalanceResultSchema = z.strictObject({
  chainRef: ChainRefSchema,
  address: z.string().min(1),
  amountWei: z.string().regex(/^\\d+$/),
  fetchedAt: z.number().int(),
});

export const balancesMethods = {
  "ui.balances.getNative": defineMethod(
    z.strictObject({
      chainRef: ChainRefSchema,
      address: z.string().min(1),
    }),
    NativeBalanceResultSchema,
  ),
} as const;
