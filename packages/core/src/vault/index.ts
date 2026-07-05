export {
  VaultInvalidCiphertextError,
  VaultInvalidPasswordError,
  VaultInvariantViolationError,
  VaultLockedError,
  VaultNotInitializedError,
  VaultPlatformUnavailableError,
} from "./errors.js";
export type {
  CommitSecretParams,
  CreateVaultParams,
  ReencryptVaultParams,
  UnlockVaultParams,
  VaultConfig,
  VaultEnvelope,
  VaultLifecycleStatus,
  VaultService,
} from "./types.js";
export { createVaultService, VAULT_VERSION } from "./vaultService.js";
