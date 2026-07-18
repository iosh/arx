/** Shared minimum for passwords used to create or re-key a vault. */
export const VAULT_PASSWORD_MIN_LENGTH = 8;

export const getVaultPasswordLength = (password: string): number => [...password].length;
