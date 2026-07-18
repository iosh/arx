import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { AccountId } from "./accountId.js";

export type HdAccountOrigin = Readonly<{
  type: "hd";
  keyringId: HdKeyringId;
  derivationIndex: number;
}>;

export type PrivateKeyAccountOrigin = Readonly<{
  type: "private-key";
  keySourceId: KeySourceId;
}>;

export type AccountOrigin = HdAccountOrigin | PrivateKeyAccountOrigin;

export type AccountRecord = Readonly<{
  accountId: AccountId;
  origin: AccountOrigin;
  alias?: string;
  hidden: boolean;
  createAt: number;
}>;

export type AccountSelectionRecord = Readonly<{
  namespace: string;
  accountId: AccountId;
}>;

export type NamespaceAccounts = Readonly<{
  accounts: readonly AccountRecord[];
  selection: AccountSelectionRecord;
}>;

export interface AccountsReader {
  get(accountId: AccountId): Promise<AccountRecord | null>;
  getMany(accountIds: readonly AccountId[]): Promise<AccountRecord[]>;
  getNamespaceAccounts(namespace: string): Promise<NamespaceAccounts | null>;
  listByKeyringIds(keyringIds: readonly HdKeyringId[]): Promise<AccountRecord[]>;
  listByPrivateKeySourceIds(keySourceIds: readonly KeySourceId[]): Promise<AccountRecord[]>;
  listIds(): Promise<AccountId[]>;
}

export const accountPersistenceType: KeyedPersistenceType<"account", AccountRecord, AccountId> =
  defineKeyedPersistenceType<"account", AccountRecord, AccountId>("account");

export const accountSelectionPersistenceType: KeyedPersistenceType<"accountSelection", AccountSelectionRecord, string> =
  defineKeyedPersistenceType<"accountSelection", AccountSelectionRecord, string>("accountSelection");
