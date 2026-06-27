export type { WalletApi } from "../wallet/index.js";
export type { ApprovalDetail } from "../wallet/types.js";
export type {
  CoreLogger,
  CoreProviderApi,
  CoreRuntime,
  CoreRuntimeBootOptions,
  CoreRuntimeEnvironment,
  CoreStorageInput,
  CoreUnsubscribe,
  CreateCoreRuntimeInput,
} from "./coreRuntime.js";
export { createArxWallet, createArxWalletRuntime } from "./createArxWallet.js";
export { createCoreRuntime, createCoreRuntimeFromArxWalletRuntime } from "./createCoreRuntime.js";
export { createEip155WalletNamespaceModule } from "./modules/eip155.js";
export { createNamespaceManifestFromWalletNamespaceModule } from "./modules/manifestInterop.js";
export type {
  ArxWallet,
  CoreChainsStoragePorts,
  CoreStoragePorts,
  CreateArxWalletInput,
  DappConnectionRecord,
  DappConnectionsState,
  NamespaceEngineDefinition,
  NamespaceEngineFactories,
  NamespaceEngineFacts,
  WalletAccounts,
  WalletApprovalDetails,
  WalletApprovals,
  WalletAttention,
  WalletBackupStatus,
  WalletDappConnections,
  WalletNamespaceModule,
  WalletNamespaces,
  WalletNetworks,
  WalletPermissions,
  WalletProvider,
  WalletProviderConnectionState,
  WalletSession,
  WalletSetupState,
} from "./types.js";
export { assertValidWalletNamespaceModule } from "./validation.js";
