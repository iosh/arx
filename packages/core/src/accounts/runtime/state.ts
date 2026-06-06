import type { ChainNamespace, MultiNamespaceAccountsState, NamespaceAccountsState } from "./types.js";

export const cloneNamespaceAccountsState = (state: NamespaceAccountsState): NamespaceAccountsState => ({
  accountKeys: [...state.accountKeys],
  selectedAccountKey: state.selectedAccountKey ?? null,
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
  if ((prev.selectedAccountKey ?? null) !== (next.selectedAccountKey ?? null)) return false;
  if (prev.accountKeys.length !== next.accountKeys.length) return false;
  return prev.accountKeys.every((value, index) => value === next.accountKeys[index]);
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
