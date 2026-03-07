import { z } from "zod";
import { ChainRefSchema } from "../../../chains/ids.js";
import { AccountIdSchema } from "../../../storage/records.js";
import { UiOwnedAccountSummarySchema } from "../schemas.js";
import { defineMethod } from "./types.js";

export const accountsMethods = {
  "ui.accounts.switchActive": defineMethod(
    z.strictObject({
      chainRef: ChainRefSchema,
      accountId: AccountIdSchema.nullable().optional(),
    }),
    UiOwnedAccountSummarySchema.nullable(),
    { broadcastSnapshot: true },
  ),
} as const;
