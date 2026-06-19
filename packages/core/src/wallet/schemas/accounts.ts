import { z } from "zod";
import { ChainRefSchema } from "../../chains/ids.js";
import { AccountKeySchema } from "../../storage/records.js";

export const WalletApiAccountsSchemas = {
  switchActive: z.strictObject({
    chainRef: ChainRefSchema,
    accountKey: AccountKeySchema.nullable().optional(),
  }),
} satisfies Record<string, z.ZodTypeAny>;
