import { z } from "zod";
import { ChainRefSchema } from "../../chains/ids.js";

export const WalletApiChainsSchemas = {
  getSelectedChain: z.undefined(),
  list: z.undefined(),
  selectWalletChain: z.strictObject({ chainRef: ChainRefSchema }),
} satisfies Record<string, z.ZodTypeAny>;
