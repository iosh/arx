import { normalizeChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type AccountKey, assertAccountKeyMatchesChainRef, toCanonicalAddressFromAccountKey } from "./accountKey.js";
import type { AccountCodecRegistry } from "./codec.js";

export type AccountRef = string;

type AccountCodecLookup = Pick<AccountCodecRegistry, "require">;

const requireCanonicalAddress = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("canonicalAddress must be a non-empty string");
  }
  return normalized;
};

const formatAccountRef = (params: { chainRef: ChainRef; canonicalAddress: string }): AccountRef => {
  const chainRef = normalizeChainRef(params.chainRef);
  const canonicalAddress = requireCanonicalAddress(params.canonicalAddress);
  return `${chainRef}:${encodeURIComponent(canonicalAddress)}`;
};

export const toAccountRefFromAccountKey = (params: {
  chainRef: ChainRef;
  accountKey: AccountKey;
  accountCodecs: AccountCodecLookup;
}): AccountRef => {
  assertAccountKeyMatchesChainRef(params);

  const canonicalAddress = toCanonicalAddressFromAccountKey({
    accountKey: params.accountKey,
    accountCodecs: params.accountCodecs,
  });

  return formatAccountRef({
    chainRef: params.chainRef,
    canonicalAddress,
  });
};
