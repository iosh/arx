import type { ChainNamespace, MultiNamespaceAccountsState, NamespaceAccountsState } from "./types.js";

export const cloneNamespaceAccountsState = (state: NamespaceAccountsState): NamespaceAccountsState => ({
  accountIds: [...state.accountIds],
  selectedAccountId: state.selectedAccountId ?? null,
});

export const cloneMultiNamespaceAccountsState = (state: MultiNamespaceAccountsState): MultiNamespaceAccountsState => {
  const namespaces = Object.fromEntries(
    Object.entries(state.namespaces).map(([ns, value]) => [
      ns,
      cloneNamespaceAccountsState(value as NamespaceAccountsState),
    ]),
  ) as Record<ChainNamespace, NamespaceAccountsState>;
  return { namespaces };
};

const isSameNamespaceAccountsState = (prev?: NamespaceAccountsState, next?: NamespaceAccountsState) => {
  if (!prev || !next) return false;
  if ((prev.selectedAccountId ?? null) !== (next.selectedAccountId ?? null)) return false;
  if (prev.accountIds.length !== next.accountIds.length) return false;
  return prev.accountIds.every((value, index) => value === next.accountIds[index]);
};

export const isSameMultiNamespaceAccountsState = (
  prev?: MultiNamespaceAccountsState,
  next?: MultiNamespaceAccountsState,
) => {
  if (!prev || !next) return false;
  const prevNamespaces = Object.keys(prev.namespaces);
  const nextNamespaces = Object.keys(next.namespaces);
  if (prevNamespaces.length !== nextNamespaces.length) return false;
  return prevNamespaces.every((ns) => isSameNamespaceAccountsState(prev.namespaces[ns], next.namespaces[ns]));
};
