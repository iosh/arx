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

export type VaultStatus = {
  isUnlocked: boolean;
  hasEnvelope: boolean;
};

export type CreateVaultParams = {
  password: string;
};

export type SealVaultParams = {
  // Payload bytes to seal into a new vault envelope.
  secret: Uint8Array;
} & CreateVaultParams;

export type UnlockVaultParams = {
  password: string;
  envelope?: VaultEnvelope;
};

export type CommitSecretParams = {
  secret: Uint8Array;
};

export type ReencryptParams = {
  newPassword: string;
  // Optional: allow reencrypt while locked (decrypt with current password first).
  currentPassword?: string;
  rotateSalt?: boolean;
};

export type VaultConfig = {
  iterations?: number;
  saltBytes?: number;
  ivBytes?: number;
};

export interface VaultService {
  // Creates or reseals the vault envelope and keeps secret material out of the unlocked session.
  initialize(params: SealVaultParams): Promise<VaultEnvelope>;
  unlock(params: UnlockVaultParams): Promise<void>;
  lock(): void;

  exportSecret(): Uint8Array;
  commitSecret(params: CommitSecretParams): Promise<VaultEnvelope>; // uses current derived key, unlocked only
  reencrypt(params: ReencryptParams): Promise<VaultEnvelope>;

  // Imports an existing envelope without reviving an unlocked session.
  importEnvelope(envelope: VaultEnvelope): void;
  verifyPassword(password: string): Promise<void>;
  getEnvelope(): VaultEnvelope | null;
  getStatus(): VaultStatus;
  isUnlocked(): boolean;
}
