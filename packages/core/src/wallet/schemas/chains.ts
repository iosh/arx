import { z } from "zod";
import { ChainRefSchema } from "../../chains/ids.js";

export const WalletApiChainsSchemas = {
  selectWalletChain: z.strictObject({ chainRef: ChainRefSchema }),
} satisfies Record<string, z.ZodTypeAny>;
