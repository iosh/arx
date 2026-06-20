import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { AccountKeySchema } from "../../../storage/records.js";
import { defineMethod } from "./types.js";

export const balancesMethods = {
  "ui.balances.getNative": defineMethod(
    "query",
    z.strictObject({
      chainRef: ChainRefSchema,
      accountKey: AccountKeySchema,
    }),
  ),
} as const;
