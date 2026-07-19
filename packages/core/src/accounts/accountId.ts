import type { Namespace } from "../namespaces/types.js";

/** Namespace-scoped wallet identity. Unlike CAIP-10, it does not include a chain reference. */
export type AccountId = string;

export const parseAccountId = (accountId: AccountId): { namespace: Namespace; payload: string } => {
  const separatorIndex = accountId.indexOf(":");

  return {
    namespace: accountId.slice(0, separatorIndex),
    payload: accountId.slice(separatorIndex + 1),
  };
};

export const getAccountIdNamespace = (accountId: AccountId): Namespace => parseAccountId(accountId).namespace;

export const formatAccountId = (params: { namespace: Namespace; payload: string }): AccountId =>
  `${params.namespace}:${params.payload}`;
