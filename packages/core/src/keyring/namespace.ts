import type { AddressNormalizer } from "../chains/address.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "./types.js";

export type KeyringKind = "hd" | "private-key";

export type NamespaceKeyringFactories = {
  hd?: () => HierarchicalDeterministicKeyring;
  "private-key"?: () => SimpleKeyring;
};

export type NamespaceConfig = {
  namespace: string; // e.g., "eip155", "conflux"
  toCanonicalAddress: AddressNormalizer;
  factories: NamespaceKeyringFactories;
};

// Namespace + canonical address → global dedupe key
export const getAddressKey = (namespace: string, value: string, toCanonicalAddress: AddressNormalizer): string =>
  `${namespace}:${toCanonicalAddress(value)}`;
