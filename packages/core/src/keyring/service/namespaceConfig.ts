import type { NamespaceAccountAddressing } from "../../accounts/addressing/addressing.js";
import type { ChainRef } from "../../chains/ids.js";
import { KeyringUnsupportedKindError } from "../errors.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../types.js";

export type KeyringKind = "hd" | "private-key";

export type NamespaceKeyringFactories = {
  hd: () => HierarchicalDeterministicKeyring;
  "private-key": () => SimpleKeyring;
};

export type NamespaceConfig<TNamespace extends string = string> = {
  namespace: TNamespace;
  defaultChainRef: ChainRef;
  accountAddressing: NamespaceAccountAddressing;
  factories: NamespaceKeyringFactories;
};

export const createUnsupportedKeyringFactories = (namespace: string): NamespaceKeyringFactories => ({
  hd: () => {
    throw new KeyringUnsupportedKindError(namespace, "hd");
  },
  "private-key": () => {
    throw new KeyringUnsupportedKindError(namespace, "private-key");
  },
});
