export { createArxWallet } from "./createArxWallet.js";
export { createEip155WalletNamespaceModule } from "./modules/eip155.js";
export { createNamespaceManifestFromWalletNamespaceModule } from "./modules/manifestInterop.js";
export type {
  ArxWallet,
  ArxWalletStoragePorts,
  CreateArxWalletInput,
  NamespaceEngineDefinition,
  NamespaceEngineFactories,
  NamespaceEngineFacts,
  WalletNamespaceModule,
  WalletNamespaces,
} from "./types.js";
export { assertValidWalletNamespaceModule } from "./validation.js";
