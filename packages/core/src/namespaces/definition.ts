import type { AccountAddressCodec } from "../accounts/accountAddressCodec.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "../chains/definition.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";

/** Pure namespace-specific implementations required by Wallet and Networks. */
export type NamespaceDefinition<TNamespace extends string = string> = Readonly<{
  namespace: TNamespace;
  accountAddressCodec: AccountAddressCodec;
  chainAddressing: NamespaceChainAddressing;
  keyring: KeyringNamespaceAdapter;
  builtinChains: readonly ChainDefinitionSeed<RpcEndpoint>[];
}>;
