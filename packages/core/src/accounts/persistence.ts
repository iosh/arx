import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import {
  defineKeyedPersistenceType,
  defineSingletonPersistenceType,
  type KeyedPersistenceType,
  type SingletonPersistenceType,
} from "../persistence/definition.js";
import type { AccountGroupId } from "./accountGroupId.js";
import type { AccountId } from "./accountId.js";

export type HdAccountOrigin = Readonly<{
  type: "hd";
  hdKeyringId: HdKeyringId;
  derivationIndex: number;
}>;

export type PrivateKeyAccountOrigin = Readonly<{
  type: "private-key";
  keySourceId: KeySourceId;
}>;

export type AccountOrigin = HdAccountOrigin | PrivateKeyAccountOrigin;

export type AccountGroupSource =
  | Readonly<{ type: "bip39"; keySourceId: KeySourceId; accountIndex: number }>
  | Readonly<{ type: "private-key"; keySourceId: KeySourceId }>;

export type AccountGroupRecord = Readonly<{
  accountGroupId: AccountGroupId;
  source: AccountGroupSource;
  alias?: string;
  hidden: boolean;
  createdAt: number;
}>;

export type AccountMemberRecord = Readonly<{
  accountId: AccountId;
  accountGroupId: AccountGroupId;
  origin: AccountOrigin;
}>;

export type AccountSelectionRecord = Readonly<{
  accountGroupId: AccountGroupId;
}>;

export interface AccountsReader {
  listGroups(): Promise<AccountGroupRecord[]>;
  listRecords(): Promise<AccountMemberRecord[]>;
  getSelection(): Promise<AccountSelectionRecord | null>;
}

export const accountGroupWrites: KeyedPersistenceType<"accountGroup", AccountGroupRecord, AccountGroupId> =
  defineKeyedPersistenceType<"accountGroup", AccountGroupRecord, AccountGroupId>("accountGroup");

export const accountWrites: KeyedPersistenceType<"account", AccountMemberRecord, AccountId> =
  defineKeyedPersistenceType<"account", AccountMemberRecord, AccountId>("account");

export const accountSelectionWrites: SingletonPersistenceType<"accountSelection", AccountSelectionRecord> =
  defineSingletonPersistenceType<"accountSelection", AccountSelectionRecord>("accountSelection");
