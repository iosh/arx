import { z } from "zod";
import { defineMethod } from "./types.js";

const MnemonicWordSchema = z.string().trim().min(1);
const MnemonicWordsSchema = z.union([z.array(MnemonicWordSchema).length(12), z.array(MnemonicWordSchema).length(24)]);

const GenerateMnemonicParamsSchema = z
  .strictObject({
    wordCount: z.union([z.literal(12), z.literal(24)]).optional(),
  })
  .optional();

const PasswordSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, { message: "Password cannot be empty." });

const CreateWalletFromMnemonicParamsSchema = z.strictObject({
  password: PasswordSchema,
  words: MnemonicWordsSchema,
  alias: z.string().min(1).optional(),
  skipBackup: z.boolean().optional(),
  namespace: z.string().min(1).optional(),
});

const ImportWalletFromMnemonicParamsSchema = z.strictObject({
  password: PasswordSchema,
  words: MnemonicWordsSchema,
  alias: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
});

const ImportWalletFromPrivateKeyParamsSchema = z.strictObject({
  password: PasswordSchema,
  privateKey: z.string().min(1),
  alias: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
});

export const onboardingMethods = {
  "ui.onboarding.openTab": defineMethod("command", z.strictObject({ reason: z.string().min(1) })),

  "ui.onboarding.generateMnemonic": defineMethod("command", GenerateMnemonicParamsSchema),

  "ui.onboarding.createWalletFromMnemonic": defineMethod("command", CreateWalletFromMnemonicParamsSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  "ui.onboarding.importWalletFromMnemonic": defineMethod("command", ImportWalletFromMnemonicParamsSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  "ui.onboarding.importWalletFromPrivateKey": defineMethod("command", ImportWalletFromPrivateKeyParamsSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),
} as const;
