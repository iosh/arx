export type VaultKdfName = "pbkdf2";
export type VaultKdfHash = "sha256";
export type VaultCipherName = "aes-gcm";

export type VaultEnvelope = {
  version: 1;
  kdf: {
    name: VaultKdfName;
    hash: VaultKdfHash;
    salt: string; // base64
    iterations: number;
  };
  cipher: {
    name: VaultCipherName;
    iv: string; // base64
    data: string; // base64
  };
};

export type VaultLifecycleStatus = "uninitialized" | "locked" | "unlocked";

export type CreateVaultParams = {
  password: string;
  // Payload bytes to seal into a new vault envelope.
  secret: Uint8Array;
};

export type UnlockVaultParams = {
  password: string;
  envelope?: VaultEnvelope;
};

export type CommitSecretParams = {
  secret: Uint8Array;
};

export type ReencryptVaultParams = {
  newPassword: string;
  rotateSalt?: boolean;
};

export type VaultConfig = {
  iterations?: number;
  saltBytes?: number;
  ivBytes?: number;
};

export interface VaultService {
  // Creates a locked vault envelope from the provided secret bytes.
  initialize(params: CreateVaultParams): Promise<VaultEnvelope>;
  unlock(params: UnlockVaultParams): Promise<void>;
  lock(): void;
  clear(): void;

  exportSecret(): Uint8Array;
  // Uses the current unlocked session key.
  commitSecret(params: CommitSecretParams): Promise<VaultEnvelope>;
  reencrypt(params: ReencryptVaultParams): Promise<VaultEnvelope>;

  // Imports an existing envelope without reviving an unlocked session.
  loadEnvelope(envelope: VaultEnvelope): void;
  verifyPassword(password: string): Promise<void>;
  getEnvelope(): VaultEnvelope | null;
  getStatus(): VaultLifecycleStatus;
}
