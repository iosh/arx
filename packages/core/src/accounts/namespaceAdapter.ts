import type { Namespace } from "../namespaces/types.js";
import type { AccountId } from "./accountId.js";

export type AccountsNamespaceAdapter = Readonly<{
  namespace: Namespace;
  addressForAccountId(input: { accountId: AccountId }): Readonly<{
    canonicalAddress: string;
    displayAddress: string;
  }>;
}>;

export type AccountsNamespaceAdapters = Readonly<Record<Namespace, AccountsNamespaceAdapter>>;
