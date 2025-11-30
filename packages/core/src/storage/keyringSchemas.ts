import { z } from "zod";
import { epochMillisecondsSchema } from "./schemas.js";

// Keyring types: hd (mnemonic) and private-key (single imported key)
export const KEYRING_TYPES = ["hd", "private-key"] as const;
export type KeyringType = (typeof KEYRING_TYPES)[number];
export const KeyringTypeSchema = z.enum(KEYRING_TYPES);

export const KeyringMetaSchema = z.strictObject({
  id: z.string().uuid(),
  type: KeyringTypeSchema,
  createdAt: epochMillisecondsSchema,
  alias: z.string().optional(), // user label for keyring
  backedUp: z.boolean().optional(), // hd only: mnemonic backup flag
  derivedCount: z.number().int().min(0).optional(), // hd only: next derivation index
});
export type KeyringMeta = z.infer<typeof KeyringMetaSchema>;

export const AccountMetaSchema = z.strictObject({
  address: z.string().regex(/^0x[a-f0-9]{40}$/), // canonical lower-case EVM address
  keyringId: z.string().uuid(),
  derivationIndex: z.number().int().min(0).optional(), // hd only
  alias: z.string().optional(),
  createdAt: epochMillisecondsSchema,
  hidden: z.boolean().optional(), // hd soft-hide
});
export type AccountMeta = z.infer<typeof AccountMetaSchema>;

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
