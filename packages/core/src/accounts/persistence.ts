import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import type { Namespace } from "../namespaces/types.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
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

export type AccountRecord = Readonly<{
  accountId: AccountId;
  origin: AccountOrigin;
  alias?: string;
  hidden: boolean;
  createdAt: number;
}>;

export type AccountSelectionRecord = Readonly<{
  namespace: Namespace;
  accountId: AccountId;
}>;

export interface AccountsReader {
  listRecords(): Promise<AccountRecord[]>;
  listSelections(): Promise<AccountSelectionRecord[]>;
}

export const accountPersistenceType: KeyedPersistenceType<"account", AccountRecord, AccountId> =
  defineKeyedPersistenceType<"account", AccountRecord, AccountId>("account");

export const accountSelectionPersistenceType: KeyedPersistenceType<"accountSelection", AccountSelectionRecord, string> =
  defineKeyedPersistenceType<"accountSelection", AccountSelectionRecord, string>("accountSelection");
