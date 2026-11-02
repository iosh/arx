import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { AccountGroupId } from "./accountGroupId.js";
import type { AccountId } from "./accountId.js";
import type { AccountGroupRecord, AccountOrigin } from "./persistence.js";

export type AccountMember = Readonly<{
  accountId: AccountId;
  accountGroupId: AccountGroupId;
  namespace: Namespace;
  origin: AccountOrigin;
  /** Projected from the group's visibility; never persisted on the member. */
  hidden: boolean;
}>;

export type AccountGroup = AccountGroupRecord &
  Readonly<{
    members: readonly [AccountMember, ...AccountMember[]];
    selected: boolean;
  }>;

/** A complete address belonging to an account's namespace. */
export type Address = Readonly<{
  accountId: AccountId;
  address: string;
  namespace: Namespace;
}>;

export type AccountAddress = Readonly<{
  accountId: AccountId;
  chainRef: ChainRef;
  canonicalAddress: string;
  displayAddress: string;
}>;

export type AccountsChanged = Readonly<{
  type: "accountsChanged";
  accountGroupIds: readonly AccountGroupId[];
  accountIds: readonly AccountId[];
  namespaces: readonly Namespace[];
}>;
