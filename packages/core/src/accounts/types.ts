import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { AccountId } from "./accountId.js";
import type { AccountOrigin } from "./persistence.js";

export type Account = Readonly<{
  accountId: AccountId;
  namespace: Namespace;
  origin: AccountOrigin;
  alias?: string;
  hidden: boolean;
  selected: boolean;
  createdAt: number;
}>;

export type AccountAddress = Readonly<{
  accountId: AccountId;
  chainRef: ChainRef;
  canonicalAddress: string;
  displayAddress: string;
}>;

export type AccountsChanged = Readonly<{
  type: "accountsChanged";
  accountIds: readonly AccountId[];
  namespaces: readonly Namespace[];
}>;
