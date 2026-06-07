import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { defineMethod } from "./types.js";

export const balancesMethods = {
  "ui.balances.getNative": defineMethod(
    "query",
    z.strictObject({
      chainRef: ChainRefSchema,
      address: z.string().min(1),
    }),
  ),
} as const;
