export const DOMAIN_SCHEMA_VERSION = 1;

export type { ChainDefinitionEntity, ChainDefinitionSource } from "./schemas/chainDefinition.js";
export {
  CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  ChainDefinitionEntitySchema,
  ChainDefinitionSourceSchema,
} from "./schemas/chainDefinition.js";
export {
  RpcEndpointHealthSchema,
  RpcEndpointInfoSchema,
  RpcEndpointStateSchema,
  RpcErrorSnapshotSchema,
  RpcStrategySchema,
} from "./schemas/rpc.js";
export {
  Eip155TransactionPayloadSchema,
  Eip155TransactionRequestSchema,
  TransactionErrorSchema,
  TransactionPayloadSchema,
  TransactionPreparedSchema,
  TransactionReceiptSchema,
  TransactionReplacementRelationSchema,
  TransactionRequestSchema,
  TransactionSubmissionLocatorSchema,
  TransactionSubmittedSchema,
} from "./schemas/transactions.js";
export type { VaultMetaSnapshot } from "./schemas/vaultMeta.js";
export { VAULT_META_SNAPSHOT_VERSION, VaultMetaSnapshotSchema } from "./schemas/vaultMeta.js";
