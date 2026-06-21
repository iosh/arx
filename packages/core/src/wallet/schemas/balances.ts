import { z } from "zod";
import { ChainRefSchema } from "../../chains/ids.js";
import { AccountKeySchema } from "../../storage/records.js";

export const WalletApiBalancesSchemas = {
  getNative: z.strictObject({
    chainRef: ChainRefSchema,
    accountKey: AccountKeySchema,
  }),
} satisfies Record<string, z.ZodTypeAny>;
