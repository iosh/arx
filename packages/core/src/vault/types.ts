export type VaultAlgorithm = "pbkdf2-sha256";

export type VaultCiphertext = {
  version: number;
  algorithm: VaultAlgorithm;
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

export type SealVaultParams = {
  password: string;
  secret: Uint8Array;
};

export type VaultConfig = {
  iterations?: number;
  saltBytes?: number;
  ivBytes?: number;
  secretBytes?: number;
};

export interface VaultService {
  initialize(params: InitializeVaultParams): Promise<VaultCiphertext>;
  unlock(params: UnlockVaultParams): Promise<Uint8Array>;
  lock(): void;
  exportKey(): Uint8Array;
  seal(params: SealVaultParams): Promise<VaultCiphertext>;
  importCiphertext(ciphertext: VaultCiphertext): void;
  getCiphertext(): VaultCiphertext | null;
  getStatus(): VaultStatus;
  isUnlocked(): boolean;
}
