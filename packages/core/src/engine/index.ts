export { createArxWallet } from "./createArxWallet.js";
export { createEip155WalletNamespaceModule } from "./modules/eip155.js";
export { createNamespaceManifestFromWalletNamespaceModule } from "./modules/manifestInterop.js";
export type {
  ArxWallet,
  ArxWalletStoragePorts,
  CreateArxWalletInput,
  DappConnectionProjection,
  DappConnectionRecord,
  DappConnectionsState,
  NamespaceEngineDefinition,
  NamespaceEngineFactories,
  NamespaceEngineFacts,
  WalletAccounts,
  WalletApprovals,
  WalletAttention,
  WalletBackupStatus,
  WalletCreateUiOptions,
  WalletDappConnections,
  WalletNamespaceModule,
  WalletNamespaces,
  WalletNetworks,
  WalletPermissions,
  WalletProvider,
  WalletProviderConnectionProjection,
  WalletSession,
  WalletSetupState,
  WalletSnapshots,
  WalletTransactions,
  WalletUi,
  WalletUiDispatchInput,
} from "./types.js";
export { assertValidWalletNamespaceModule } from "./validation.js";
