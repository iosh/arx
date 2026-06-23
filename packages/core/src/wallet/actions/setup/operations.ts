import { z } from "zod";
import { defineWalletOperation, type WalletOperation } from "../../operation.js";
import type { WalletApiSetupStatusResult } from "../../types.js";

const SetupGetStatusInputSchema = z.undefined();

export type SetupOperations = Readonly<{
  getStatus: WalletOperation<typeof SetupGetStatusInputSchema, WalletApiSetupStatusResult>;
}>;

export const setupOperations: SetupOperations = {
  getStatus: defineWalletOperation<WalletApiSetupStatusResult>()({
    input: SetupGetStatusInputSchema,
  }),
} as const;
