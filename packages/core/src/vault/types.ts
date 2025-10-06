export type VaultCiphertext = {
  version: number;
  salt: string;
  iterations: number;
  iv: string;
  cipher: string;
  createdAt: number;
};

export type VaultStatus = {
  isUnlocked: boolean;
  hasCiphertext: boolean;
};

export type InitializeVaultParams = {
  password: string;
  secret?: Uint8Array;
};

export type UnlockVaultParams = {
  password: string;
  ciphertext?: VaultCiphertext;
};

export type VaultConfig = {
  pbkdf2?: {
    targetDurationMs?: number;
    minimumIterations?: number;
    maximumIterations?: number;
    saltBytes?: number;
  };
  aes?: {
    ivBytes?: number;
  };
  secretBytes?: number;
};

export interface VaultService {
  initialize(params: InitializeVaultParams): Promise<VaultCiphertext>;
  unlock(params: UnlockVaultParams): Promise<Uint8Array>;
  lock(): void;
  exportKey(): Uint8Array;
  seal(secret: Uint8Array): Promise<VaultCiphertext>;
  importCiphertext(ciphertext: VaultCiphertext): void;
  getCiphertext(): VaultCiphertext | null;
  getStatus(): VaultStatus;
  isUnlocked(): boolean;
}
