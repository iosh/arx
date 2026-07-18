import type { ChainRef } from "../chains/ids.js";
import type { Namespace } from "../namespaces/types.js";
import type { AccountId } from "./accountId.js";
import { AccountNamespaceUnsupportedError } from "./errors.js";

export type AccountsNamespaceAdapter = Readonly<{
  namespace: Namespace;
  accountIdFromAddress(input: { chainRef: ChainRef; address: string }): AccountId;
  addressForAccountId(input: { chainRef: ChainRef; accountId: AccountId }): Readonly<{
    canonicalAddress: string;
    displayAddress: string;
  }>;
}>;

export type AccountsNamespaceAdapters = Readonly<Record<Namespace, AccountsNamespaceAdapter | undefined>>;

export const getAccountsNamespaceAdapter = (
  adapters: AccountsNamespaceAdapters,
  namespace: Namespace,
): AccountsNamespaceAdapter => {
  const adapter = adapters[namespace];
  if (!adapter) throw new AccountNamespaceUnsupportedError(namespace);
  return adapter;
};
