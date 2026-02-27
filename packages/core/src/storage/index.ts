export type { KeyringType, VaultKeyringEntry, VaultKeyringPayload } from "./keyringSchemas.js";
export {
  KEYRING_TYPES,
  KEYRING_VAULT_ENTRY_VERSION,
  KeyringTypeSchema,
  VaultKeyringEntrySchema,
  VaultKeyringPayloadSchema,
} from "./keyringSchemas.js";
export type {
  AccountId,
  AccountNamespace,
  AccountRecord,
  KeyringMetaRecord,
  NetworkPreferencesRecord,
  NetworkRpcPreference,
  PermissionCapability as StoragePermissionCapability,
  PermissionGrantRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
  TransactionStatus as StorageTransactionStatus,
} from "./records.js";
// Explicit exports to keep the public surface intentional.
// Note: Some record-level types share names with controller types. Export those with aliases
// to avoid collisions when consumers import from "@arx/core" root exports.
export {
  AccountIdSchema,
  AccountNamespaceSchema,
  AccountPayloadHexSchema,
  AccountRecordSchema,
  KeyringMetaRecordSchema,
  NetworkPreferencesRecordSchema,
  NetworkRpcPreferenceSchema,
  PermissionCapabilitySchema,
  PermissionGrantSchema,
  PermissionRecordSchema,
  SettingsRecordSchema,
  TransactionRecordSchema,
  TransactionStatusSchema,
} from "./records.js";

export type { ChainRegistryEntity, VaultMetaSnapshot } from "./schemas.js";
export {
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  ChainRegistryEntitySchema,
  DOMAIN_SCHEMA_VERSION,
  VAULT_META_SNAPSHOT_VERSION,
  VaultMetaSnapshotSchema,
} from "./schemas.js";

export type { VaultMetaPort } from "./types.js";
