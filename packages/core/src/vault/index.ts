export type {
  CommitSecretParams,
  CreateVaultParams,
  ReencryptParams,
  SealVaultParams,
  UnlockVaultParams,
  VaultConfig,
  VaultEnvelope,
  VaultService,
  VaultStatus,
} from "./types.js";
export { createVaultService, VAULT_VERSION } from "./vaultService.js";
