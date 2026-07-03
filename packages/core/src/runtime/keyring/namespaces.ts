import type { NamespaceAccountAddressing } from "../../accounts/addressing/addressing.js";
import type { ChainRef } from "../../chains/ids.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";

export type KeyringKind = "hd" | "private-key";

export type NamespaceKeyringFactories = {
  hd?: () => HierarchicalDeterministicKeyring;
  "private-key"?: () => SimpleKeyring;
};

export type NamespaceConfig = {
  namespace: string; // e.g., "eip155", "conflux"
  defaultChainRef: ChainRef;
  accountAddressing: NamespaceAccountAddressing;
  factories: NamespaceKeyringFactories;
};
