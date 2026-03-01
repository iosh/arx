export type {
  CommitSecretParams,
  InitializeVaultParams,
  ReencryptParams,
  UnlockVaultParams,
  VaultConfig,
  VaultEnvelope,
  VaultService,
  VaultStatus,
} from "./types.js";
export { createVaultService, VAULT_VERSION } from "./vaultService.js";
