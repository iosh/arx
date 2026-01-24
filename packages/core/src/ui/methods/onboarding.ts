import { z } from "zod";
import { defineMethod } from "./types.js";

const MnemonicWordSchema = z.string().trim().min(1);
const MnemonicWordsSchema = z.union([z.array(MnemonicWordSchema).length(12), z.array(MnemonicWordSchema).length(24)]);

const OpenOnboardingTabResultSchema = z.strictObject({
  activationPath: z.enum(["focus", "create", "debounced"]),
  tabId: z.number().int().optional(),
});

const GenerateMnemonicParamsSchema = z
  .strictObject({
    wordCount: z.union([z.literal(12), z.literal(24)]).optional(),
  })
  .optional();

const GenerateMnemonicResultSchema = z.strictObject({
  words: MnemonicWordsSchema,
});

const CreateWalletFromMnemonicParamsSchema = z.strictObject({
  password: z.string().min(1).optional(),
  words: MnemonicWordsSchema,
  alias: z.string().min(1).optional(),
  skipBackup: z.boolean().optional(),
  namespace: z.string().min(1).optional(),
});

const CreateWalletFromMnemonicResultSchema = z.strictObject({
  keyringId: z.uuid(),
  address: z.string().min(1),
});

const ImportWalletFromMnemonicParamsSchema = z.strictObject({
  password: z.string().min(1).optional(),
  words: MnemonicWordsSchema,
  alias: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
});

const KeyringAccountSchema = z.strictObject({
  address: z.string().min(1),
  derivationPath: z.string().nullable(),
  derivationIndex: z.number().int().nullable(),
  source: z.enum(["derived", "imported"]),
});

const ImportWalletFromPrivateKeyParamsSchema = z.strictObject({
  password: z.string().min(1).optional(),
  privateKey: z.string().min(1),
  alias: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
});

const ImportWalletFromPrivateKeyResultSchema = z.strictObject({
  keyringId: z.uuid(),
  account: KeyringAccountSchema,
});

export const onboardingMethods = {
  "ui.onboarding.openTab": defineMethod(z.strictObject({ reason: z.string().min(1) }), OpenOnboardingTabResultSchema),

  "ui.onboarding.generateMnemonic": defineMethod(GenerateMnemonicParamsSchema, GenerateMnemonicResultSchema),

  "ui.onboarding.createWalletFromMnemonic": defineMethod(
    CreateWalletFromMnemonicParamsSchema,
    CreateWalletFromMnemonicResultSchema,
    { broadcastSnapshot: true, persistVaultMeta: true, holdBroadcast: true },
  ),

  "ui.onboarding.importWalletFromMnemonic": defineMethod(
    ImportWalletFromMnemonicParamsSchema,
    CreateWalletFromMnemonicResultSchema,
    { broadcastSnapshot: true, persistVaultMeta: true, holdBroadcast: true },
  ),

  "ui.onboarding.importWalletFromPrivateKey": defineMethod(
    ImportWalletFromPrivateKeyParamsSchema,
    ImportWalletFromPrivateKeyResultSchema,
    { broadcastSnapshot: true, persistVaultMeta: true, holdBroadcast: true },
  ),
} as const;
