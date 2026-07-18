import type { AccountsNamespaceAdapter } from "../accounts/namespaceAdapter.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../chains/definition.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";

/** Pure namespace-specific implementations required by Accounts, Wallet, and Networks. */
export type NamespaceDefinition<TNamespace extends string = string> = Readonly<{
  namespace: TNamespace;
  accounts: AccountsNamespaceAdapter;
  chainAddressing: NamespaceChainAddressing;
  keyring: KeyringNamespaceAdapter;
  builtinChains: readonly ChainDefinitionSeed<RpcEndpoint>[];
}>;
