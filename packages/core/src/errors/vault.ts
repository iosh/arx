type VaultErrorCode =
  | "ARX_VAULT_NOT_INITIALIZED"
  | "ARX_VAULT_LOCKED"
  | "ARX_VAULT_INVALID_CIPHERTEXT"
  | "ARX_VAULT_INVALID_PASSWORD";

type VaultError = Error & { code: VaultErrorCode };

const createVaultError = (message: string, code: VaultErrorCode): VaultError => {
  const error = new Error(message) as VaultError;
  error.name = "VaultError";
  error.code = code;
  return error;
};

export const vaultErrors = {
  notInitialized: (): VaultError => createVaultError("Vault has not been initialized", "ARX_VAULT_NOT_INITIALIZED"),
  locked: (): VaultError => createVaultError("Vault is locked", "ARX_VAULT_LOCKED"),
  invalidCiphertext: (): VaultError =>
    createVaultError("Vault ciphertext is invalid or corrupted", "ARX_VAULT_INVALID_CIPHERTEXT"),
  invalidPassword: (): VaultError =>
    createVaultError("Vault password is missing or incorrect", "ARX_VAULT_INVALID_PASSWORD"),
};
