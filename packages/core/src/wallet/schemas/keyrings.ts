import { z } from "zod";
import { AccountKeySchema } from "../../storage/records.js";
import { WalletApiSharedSchemas } from "./shared.js";

export const WalletApiKeyringsSchemas = {
  confirmNewMnemonic: z.strictObject({
    words: z.array(z.string().min(1)).min(12).max(24),
    alias: z.string().min(1).optional(),
    skipBackup: z.boolean().optional(),
    namespace: z.string().min(1).optional(),
  }),
  importMnemonic: z.strictObject({
    words: z.array(z.string().min(1)).min(12).max(24),
    alias: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
  importPrivateKey: z.strictObject({
    privateKey: z.string().min(1),
    alias: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
  getAccountsByKeyring: z.strictObject({
    keyringId: z.uuid(),
    includeHidden: z.boolean().optional(),
  }),
  getBackupStatus: z.undefined(),
  deriveAccount: z.strictObject({ keyringId: z.uuid() }),
  renameKeyring: z.strictObject({ keyringId: z.uuid(), alias: z.string().min(1) }),
  renameAccount: z.strictObject({ accountKey: AccountKeySchema, alias: z.string().min(1) }),
  markBackedUp: z.strictObject({ keyringId: z.uuid() }),
  hideHdAccount: z.strictObject({ accountKey: AccountKeySchema }),
  unhideHdAccount: z.strictObject({ accountKey: AccountKeySchema }),
  removePrivateKeyKeyring: z.strictObject({ keyringId: z.uuid() }),
  exportMnemonic: z.strictObject({ keyringId: z.uuid(), password: WalletApiSharedSchemas.password }),
  exportPrivateKey: z.strictObject({ accountKey: AccountKeySchema, password: WalletApiSharedSchemas.password }),
} satisfies Record<string, z.ZodTypeAny>;
