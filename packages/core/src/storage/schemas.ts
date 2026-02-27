export const DOMAIN_SCHEMA_VERSION = 1;

export type { ChainRegistryEntity } from "./schemas/chainRegistry.js";
export { CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION, ChainRegistryEntitySchema } from "./schemas/chainRegistry.js";
export {
  RpcEndpointHealthSchema,
  RpcEndpointInfoSchema,
  RpcEndpointStateSchema,
  RpcErrorSnapshotSchema,
  RpcStrategySchema,
} from "./schemas/rpc.js";
export {
  Eip155TransactionPayloadSchema,
  GenericTransactionRequestSchema,
  TransactionErrorSchema,
  TransactionReceiptSchema,
  TransactionRequestSchema,
  TransactionWarningSchema,
} from "./schemas/transactions.js";
export type { VaultMetaSnapshot } from "./schemas/vaultMeta.js";
export { VAULT_META_SNAPSHOT_VERSION, VaultMetaSnapshotSchema } from "./schemas/vaultMeta.js";
