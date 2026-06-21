import { z } from "zod";
import { WalletApiSharedSchemas } from "./shared.js";

export const WalletApiOnboardingSchemas = {
  getStatus: z.undefined(),
  generateMnemonic: z
    .strictObject({
      wordCount: z.union([z.literal(12), z.literal(24)]).optional(),
    })
    .optional(),
  createWalletFromMnemonic: z.strictObject({
    password: WalletApiSharedSchemas.password,
    words: WalletApiSharedSchemas.mnemonicWords,
    alias: z.string().min(1).optional(),
    skipBackup: z.boolean().optional(),
    namespace: z.string().min(1).optional(),
  }),
  importWalletFromMnemonic: z.strictObject({
    password: WalletApiSharedSchemas.password,
    words: WalletApiSharedSchemas.mnemonicWords,
    alias: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
  importWalletFromPrivateKey: z.strictObject({
    password: WalletApiSharedSchemas.password,
    privateKey: z.string().min(1),
    alias: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
} satisfies Record<string, z.ZodTypeAny>;
