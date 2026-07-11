export type { VaultBootstrap } from "./bootstrap.js";
export { loadVaultBootstrap } from "./bootstrap.js";
export type { UnlockedVault } from "./crypto.js";
export { changeVaultPassword, createUnlockedVault, replaceVaultSecrets, unlockVaultRecord } from "./crypto.js";
export {
  VaultInvalidCiphertextError,
  VaultInvalidPasswordError,
  VaultInvariantViolationError,
  VaultLockedError,
  VaultNotInitializedError,
  VaultPlatformUnavailableError,
} from "./errors.js";
export type { EncryptedVaultReader, EncryptedVaultRecord } from "./persistence.js";
export type { Bip39KeySource, LocalKeySource, PrivateKeySource, VaultSecrets } from "./secrets.js";
export { decodeVaultSecrets, encodeVaultSecrets, joinMnemonicWords } from "./secrets.js";
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
export type { VaultStatus } from "./Vault.js";
export { Vault } from "./Vault.js";
export { createVaultService, VAULT_VERSION } from "./vaultService.js";
