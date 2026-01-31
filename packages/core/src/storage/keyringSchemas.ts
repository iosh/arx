import { z } from "zod";
import { epochMillisecondsSchema } from "./schemas.js";

// Keyring types: hd (mnemonic) and private-key (single imported key)
export const KEYRING_TYPES = ["hd", "private-key"] as const;
export type KeyringType = (typeof KEYRING_TYPES)[number];
export const KeyringTypeSchema = z.enum(KEYRING_TYPES);

// Vault payload: only sensitive materials, no metadata
const HdVaultPayloadSchema = z.strictObject({
  mnemonic: z.array(z.string().min(1)).min(12), // word list; detailed check done upstream
  passphrase: z.string().optional(),
});

const PrivateKeyVaultPayloadSchema = z.strictObject({
  privateKey: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
});

export const KEYRING_VAULT_ENTRY_VERSION = 1;

export const VaultKeyringEntrySchema = z.strictObject({
  keyringId: z.uuid(),
  type: KeyringTypeSchema,
  createdAt: epochMillisecondsSchema,
  version: z.literal(KEYRING_VAULT_ENTRY_VERSION),
  payload: z.union([HdVaultPayloadSchema, PrivateKeyVaultPayloadSchema]),
  namespace: z.string().optional(),
});
export type VaultKeyringEntry = z.infer<typeof VaultKeyringEntrySchema>;

export const VaultKeyringPayloadSchema = z.strictObject({
  keyrings: z.array(VaultKeyringEntrySchema),
});
export type VaultKeyringPayload = z.infer<typeof VaultKeyringPayloadSchema>;
