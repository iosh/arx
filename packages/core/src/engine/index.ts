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
  WalletAttention,
  WalletDappConnections,
  WalletNamespaceModule,
  WalletNamespaces,
  WalletNetworks,
  WalletPermissions,
  WalletSession,
  WalletSnapshots,
} from "./types.js";
export { assertValidWalletNamespaceModule } from "./validation.js";
