import type { AccountsNamespaceAdapter } from "../accounts/namespaceAdapter.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { BuiltinNetworkSeed } from "../networks/types.js";

/** Pure namespace-specific implementations required by Accounts, Wallet, and Networks. */
export type NamespaceDefinition<TNamespace extends string = string> = Readonly<{
  namespace: TNamespace;
  accounts: AccountsNamespaceAdapter;
  chainAddressing: NamespaceChainAddressing;
  keyring: KeyringNamespaceAdapter<TNamespace>;
  builtinChains: readonly BuiltinNetworkSeed[];
}>;
