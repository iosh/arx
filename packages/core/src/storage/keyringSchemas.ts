// Keyring types: hd (mnemonic) and private-key (single imported key)
export const KEYRING_TYPES = ["hd", "private-key"] as const;
export type KeyringType = (typeof KEYRING_TYPES)[number];

export const KEYRING_VAULT_ENTRY_VERSION = 1;

export type HdVaultPayload = {
  mnemonic: string[];
  passphrase?: string | undefined;
};

export type PrivateKeyVaultPayload = {
  privateKey: string;
};

export type VaultKeyringEntry = {
  keyringId: string;
  type: KeyringType;
  createdAt: number;
  version: typeof KEYRING_VAULT_ENTRY_VERSION;
  payload: HdVaultPayload | PrivateKeyVaultPayload;
  namespace?: string | undefined;
};

export type VaultKeyringPayload = {
  keyrings: VaultKeyringEntry[];
};
