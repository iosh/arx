export {
  VaultInvalidCiphertextError,
  VaultInvalidPasswordError,
  VaultInvariantViolationError,
  VaultLockedError,
  VaultNotInitializedError,
} from "./errors.js";
export type {
  CommitSecretParams,
  CreateVaultParams,
  ReencryptVaultParams,
  SealVaultParams,
  UnlockVaultParams,
  VaultConfig,
  VaultEnvelope,
  VaultService,
  VaultStatus,
} from "./types.js";
export { createVaultService, VAULT_VERSION } from "./vaultService.js";
