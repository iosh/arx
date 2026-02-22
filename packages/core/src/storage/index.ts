export * from "./keyringSchemas.js";
export type {
  AccountId,
  AccountNamespace,
  AccountRecord,
  KeyringMetaRecord,
  NetworkPreferencesRecord,
  NetworkRpcPreference,
  PermissionGrantRecord,
  PermissionRecord,
  PermissionScope as StoragePermissionScope,
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
  PermissionGrantSchema,
  PermissionRecordSchema,
  PermissionScopeSchema,
  SettingsRecordSchema,
  TransactionRecordSchema,
  TransactionStatusSchema,
} from "./records.js";
export * from "./schemas.js";
export * from "./types.js";
