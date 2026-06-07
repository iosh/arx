export type VaultEnvelope = {
  version: 1;
  kdf: {
    name: "pbkdf2";
    hash: "sha256";
    salt: string;
    iterations: number;
  };
  cipher: {
    name: "aes-gcm";
    iv: string;
    data: string;
  };
};

export const VAULT_META_SNAPSHOT_VERSION = 1;

export type VaultMetaSnapshot = {
  version: typeof VAULT_META_SNAPSHOT_VERSION;
  updatedAt: number;
  payload: {
    envelope: VaultEnvelope | null;
    autoLockDurationMs: number;
    initializedAt: number;
  };
};
