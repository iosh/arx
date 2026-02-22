import { z } from "zod";
import { AccountIdSchema } from "../../storage/records.js";
import { UiAccountMetaSchema, UiKeyringMetaSchema } from "../schemas.js";
import { defineMethod } from "./types.js";

const KeyringAccountSchema = z.strictObject({
  address: z.string().min(1),
  derivationPath: z.string().nullable(),
  derivationIndex: z.number().int().nullable(),
  source: z.enum(["derived", "imported"]),
});

const ExportMnemonicResultSchema = z.strictObject({
  words: z.array(z.string().min(1)).min(12).max(24),
});

const ExportPrivateKeyResultSchema = z.strictObject({
  // uiBridge currently returns hex WITHOUT 0x prefix.
  privateKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

const ConfirmMnemonicResultSchema = z.strictObject({
  keyringId: z.uuid(),
  address: z.string().min(1),
});

const ImportPrivateKeyResultSchema = z.strictObject({
  keyringId: z.uuid(),
  account: KeyringAccountSchema,
});

export const keyringsMethods = {
  "ui.keyrings.confirmNewMnemonic": defineMethod(
    z.strictObject({
      words: z.array(z.string().min(1)).min(12).max(24),
      alias: z.string().min(1).optional(),
      skipBackup: z.boolean().optional(),
      namespace: z.string().min(1).optional(),
    }),
    ConfirmMnemonicResultSchema,
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.importMnemonic": defineMethod(
    z.strictObject({
      words: z.array(z.string().min(1)).min(12).max(24),
      alias: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
    }),
    ConfirmMnemonicResultSchema,
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.importPrivateKey": defineMethod(
    z.strictObject({
      privateKey: z.string().min(1),
      alias: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
    }),
    ImportPrivateKeyResultSchema,
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.deriveAccount": defineMethod(z.strictObject({ keyringId: z.uuid() }), KeyringAccountSchema, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.list": defineMethod(z.undefined(), z.array(UiKeyringMetaSchema.strict())),

  "ui.keyrings.getAccountsByKeyring": defineMethod(
    z.strictObject({ keyringId: z.uuid(), includeHidden: z.boolean().optional() }),
    z.array(UiAccountMetaSchema.strict()),
  ),

  "ui.keyrings.renameKeyring": defineMethod(
    z.strictObject({ keyringId: z.uuid(), alias: z.string().min(1) }),
    z.null(),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.renameAccount": defineMethod(
    z.strictObject({ accountId: AccountIdSchema, alias: z.string().min(1) }),
    z.null(),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.markBackedUp": defineMethod(z.strictObject({ keyringId: z.uuid() }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.hideHdAccount": defineMethod(z.strictObject({ accountId: AccountIdSchema }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.unhideHdAccount": defineMethod(z.strictObject({ accountId: AccountIdSchema }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.removePrivateKeyKeyring": defineMethod(z.strictObject({ keyringId: z.uuid() }), z.null(), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.exportMnemonic": defineMethod(
    z.strictObject({ keyringId: z.uuid(), password: z.string().min(1) }),
    ExportMnemonicResultSchema,
  ),

  "ui.keyrings.exportPrivateKey": defineMethod(
    z.strictObject({ address: z.string().min(1), password: z.string().min(1) }),
    ExportPrivateKeyResultSchema,
  ),
} as const;
