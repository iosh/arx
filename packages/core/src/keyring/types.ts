export type KeyringAccountSource = "derived" | "imported";

export type KeyringAccount<TAddress extends string = string> = {
  address: TAddress;
  derivationPath: string | null;
  derivationIndex: number | null;
  source: KeyringAccountSource;
};

export type HierarchicalDeterministicKeyringSnapshot<TAccount extends KeyringAccount = KeyringAccount> = {
  type: "hierarchical";
  accounts: TAccount[];
  nextDerivationIndex: number;
};

export type SimpleKeyringSnapshot<TAccount extends KeyringAccount = KeyringAccount> = {
  type: "simple";
  account: TAccount | null;
};

export interface HierarchicalDeterministicKeyring<TAccount extends KeyringAccount = KeyringAccount> {
  hasSecret(): boolean;
  loadFromMnemonic(mnemonic: string, options?: { passphrase?: string }): void;
  deriveAccount(index: number): TAccount;
  deriveNextAccount(): TAccount;
  getAccounts(): readonly TAccount[];
  getAccount(address: string): TAccount | undefined;
  hasAccount(address: string): boolean;
  removeAccount(address: string): void;
  exportPrivateKey(address: string): Uint8Array;
  toSnapshot(): HierarchicalDeterministicKeyringSnapshot<TAccount>;
  hydrate(snapshot: HierarchicalDeterministicKeyringSnapshot<TAccount>): void;
  clear(): void;
}

export interface SimpleKeyring<TAccount extends KeyringAccount = KeyringAccount> {
  hasSecret(): boolean;
  loadFromPrivateKey(privateKey: string | Uint8Array): void;
  importAccount(privateKey: string | Uint8Array): TAccount;
  getAccounts(): readonly TAccount[];
  getAccount(address: string): TAccount | undefined;
  hasAccount(address: string): boolean;
  removeAccount(address: string): void;
  exportPrivateKey(address: string): Uint8Array;
  toSnapshot(): SimpleKeyringSnapshot<TAccount>;
  hydrate(snapshot: SimpleKeyringSnapshot<TAccount>): void;
  clear(): void;
}

export type KeyringSnapshot<TAccount extends KeyringAccount = KeyringAccount> =
  | HierarchicalDeterministicKeyringSnapshot<TAccount>
  | SimpleKeyringSnapshot<TAccount>;
