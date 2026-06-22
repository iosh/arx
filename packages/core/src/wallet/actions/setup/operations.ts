import { z } from "zod";
import { defineWalletOperation } from "../../operation.js";

export const setupOperations = {
  getStatus: defineWalletOperation({
    input: z.undefined(),
  }),
} as const;
