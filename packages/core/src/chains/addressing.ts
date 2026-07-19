import type { ChainRef } from "../networks/chainRef.js";
import { parseChainRef } from "../networks/chainRef.js";
import { ChainAddressNamespaceNotSupportedError } from "./errors.js";
import type {
  CanonicalizeAddressParams,
  CanonicalizedAddressResult,
  FormatAddressParams,
  NamespaceChainAddressing,
} from "./types.js";

export type ChainAddressingByNamespace = Readonly<Record<string, NamespaceChainAddressing>>;

export const buildChainAddressingByNamespace = (
  entries: readonly NamespaceChainAddressing[] = [],
): ChainAddressingByNamespace => {
  const byNamespace: Record<string, NamespaceChainAddressing> = {};
  for (const entry of entries) {
    byNamespace[entry.namespace] = entry;
  }
  return byNamespace;
};

const chainAddressingForChainRef = (
  chainAddressing: ChainAddressingByNamespace,
  chainRef: ChainRef,
): NamespaceChainAddressing => {
  const { namespace } = parseChainRef(chainRef);
  const addressing = chainAddressing[namespace];
  if (addressing) return addressing;
  throw new ChainAddressNamespaceNotSupportedError({ chainRef, namespace });
};

const chainAddressFormatForChainRef = (chainAddressing: ChainAddressingByNamespace, chainRef: ChainRef) =>
  chainAddressingForChainRef(chainAddressing, chainRef).address;

export const canonicalizeChainAddress = (
  chainAddressing: ChainAddressingByNamespace,
  params: CanonicalizeAddressParams,
): CanonicalizedAddressResult => {
  return chainAddressFormatForChainRef(chainAddressing, params.chainRef).canonicalize(params);
};

export const formatChainAddress = (
  chainAddressing: ChainAddressingByNamespace,
  params: FormatAddressParams,
): string => {
  return chainAddressFormatForChainRef(chainAddressing, params.chainRef).format(params);
};

export const validateChainAddress = (
  chainAddressing: ChainAddressingByNamespace,
  params: FormatAddressParams,
): void => {
  chainAddressFormatForChainRef(chainAddressing, params.chainRef).validate?.(params);
};
