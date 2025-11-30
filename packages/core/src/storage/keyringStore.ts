import type { AccountMeta, KeyringMeta } from "./keyringSchemas.js";

export interface KeyringStorePort {
  getKeyringMetas(): Promise<KeyringMeta[]>;
  getAccountMetas(): Promise<AccountMeta[]>;

  putKeyringMetas(metas: KeyringMeta[]): Promise<void>;
  putAccountMetas(metas: AccountMeta[]): Promise<void>;

  deleteKeyringMeta(id: KeyringMeta["id"]): Promise<void>;
  deleteAccount(address: AccountMeta["address"]): Promise<void>;
  deleteAccountsByKeyring(keyringId: KeyringMeta["id"]): Promise<void>;
}
