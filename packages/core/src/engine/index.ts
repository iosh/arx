export type { WalletApi } from "../wallet/index.js";
export type { ApprovalDetail } from "../wallet/types.js";
export type {
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
export { WalletNamespaceManifestNotFoundError } from "./errors.js";
export type {
  ArxWallet,
  CoreChainsStoragePorts,
  CoreStoragePorts,
  CreateArxWalletInput,
  DappConnectionRecord,
  DappConnectionsState,
  WalletAccounts,
  WalletApprovalDetails,
  WalletApprovals,
  WalletAttention,
  WalletBackupStatus,
  WalletDappConnections,
  WalletNamespaces,
  WalletNetworks,
  WalletPermissions,
  WalletProvider,
  WalletProviderConnectionState,
  WalletSession,
  WalletSetupState,
} from "./types.js";
