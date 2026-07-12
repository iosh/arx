export type {
  AccountId,
  AccountNamespace,
  AccountRecord,
  AccountSelectionStateRecord,
  ChainRpcDefaultEndpointsRecord,
  ChainRpcEndpointOverrideRecord,
  PermissionRecord,
  ProviderChainSelectionRecord,
  WalletChainSelectionRecord,
} from "./records.js";
export { AccountIdSchema } from "./records.js";

export type { ChainDefinitionEntity, ChainDefinitionSource } from "./schemas.js";
export {
  CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  DOMAIN_SCHEMA_VERSION,
} from "./schemas.js";
