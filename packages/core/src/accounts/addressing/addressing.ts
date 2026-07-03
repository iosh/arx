import { createEip155AddressFormat } from "../../chains/eip155/address.js";
import type { ChainRef } from "../../chains/ids.js";

export type NamespaceAccountAddressing = {
  namespace: string;

  accountIdPayloadFromAddress(params: { chainRef: ChainRef; address: string }): string;
  canonicalAddressFromAccountIdPayload(params: { chainRef: ChainRef; payloadHex: string }): string;
  displayAddressFromAccountIdPayload(params: { chainRef: ChainRef; payloadHex: string }): string;
};

export type AccountAddressingByNamespace = Readonly<Record<string, NamespaceAccountAddressing>>;

export const buildAccountAddressingByNamespace = (
  entries: readonly NamespaceAccountAddressing[] = [],
): AccountAddressingByNamespace => {
  const byNamespace: Record<string, NamespaceAccountAddressing> = {};
  for (const entry of entries) {
    byNamespace[entry.namespace] = entry;
  }
  return byNamespace;
};

export const accountAddressingForNamespace = (
  accountAddressing: AccountAddressingByNamespace,
  namespace: string,
): NamespaceAccountAddressing => {
  return accountAddressing[namespace] as NamespaceAccountAddressing;
};

const eip155AddressFormat = createEip155AddressFormat();

export const eip155AccountAddressing: NamespaceAccountAddressing = {
  namespace: "eip155",

  accountIdPayloadFromAddress({ chainRef, address }) {
    const { canonical } = eip155AddressFormat.canonicalize({ chainRef, value: address });
    return canonical.slice(2);
  },

  canonicalAddressFromAccountIdPayload({ chainRef, payloadHex }) {
    return eip155AddressFormat.canonicalize({ chainRef, value: `0x${payloadHex}` }).canonical;
  },

  displayAddressFromAccountIdPayload({ chainRef, payloadHex }) {
    return eip155AddressFormat.format({ chainRef, canonical: `0x${payloadHex}` });
  },
};
