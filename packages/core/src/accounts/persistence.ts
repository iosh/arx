import type { KeySourceId } from "../keyring/types.js";
import {
  defineKeyedPersistenceType,
  defineSingletonPersistenceType,
  type KeyedPersistenceType,
  type SingletonPersistenceType,
} from "../persistence/definition.js";
import type { AccountGroupId } from "./accountGroupId.js";
import type { AccountId } from "./accountId.js";

export type AccountGroupSource =
  | Readonly<{ type: "bip39"; keySourceId: KeySourceId; accountIndex: number }>
  | Readonly<{ type: "private-key"; keySourceId: KeySourceId }>;

export type AccountGroupRecord = Readonly<{
  accountGroupId: AccountGroupId;
  source: AccountGroupSource;
  members: readonly [AccountMemberRecord, ...AccountMemberRecord[]];
  alias?: string;
  hidden: boolean;
  createdAt: number;
}>;

export type AccountMemberRecord = Readonly<{
  accountId: AccountId;
}>;

export type AccountSelectionRecord = Readonly<{
  accountGroupId: AccountGroupId;
}>;

export interface AccountsReader {
  listGroups(): Promise<readonly AccountGroupRecord[]>;
  getSelection(): Promise<AccountSelectionRecord | null>;
}

export const accountGroupWrites: KeyedPersistenceType<"accountGroup", AccountGroupRecord, AccountGroupId> =
  defineKeyedPersistenceType<"accountGroup", AccountGroupRecord, AccountGroupId>("accountGroup");

export const accountSelectionWrites: SingletonPersistenceType<"accountSelection", AccountSelectionRecord> =
  defineSingletonPersistenceType<"accountSelection", AccountSelectionRecord>("accountSelection");
