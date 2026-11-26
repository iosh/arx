import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { AccountGroupId } from "./accountGroupId.js";
import type { AccountId } from "./accountId.js";
import type { AccountGroupRecord } from "./persistence.js";

export type Account = Readonly<{
  accountId: AccountId;
  accountGroupId: AccountGroupId;
  namespace: Namespace;
  /** Display address for this namespace's default network; derived from the public identity, never persisted. */
  defaultAddress: string;
  /** Projected from the group's visibility. */
  hidden: boolean;
}>;

export type AccountGroup = Omit<AccountGroupRecord, "accounts"> &
  Readonly<{
    accounts: readonly [Account, ...Account[]];
    selected: boolean;
  }>;

/** Public identity preview before an account group is saved. */
export type AccountPreview = Pick<Account, "accountId" | "namespace" | "defaultAddress">;

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
