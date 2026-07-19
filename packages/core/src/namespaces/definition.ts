import type { AccountsNamespaceAdapter } from "../accounts/namespaceAdapter.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";

/** Groups namespace-specific implementations for Accounts, Keyring, and chain addressing. */
export type NamespaceDefinition<TNamespace extends string = string> = Readonly<{
  namespace: TNamespace;
  accounts: AccountsNamespaceAdapter;
  chainAddressing: NamespaceChainAddressing;
  keyring: KeyringNamespaceAdapter<TNamespace>;
}>;
