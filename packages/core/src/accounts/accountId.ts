import type { ChainRef } from "../chains/ids.js";
import { parseChainRef } from "../chains/index.js";
import type { AccountId } from "../db/records.js";
import { getAccountCodec } from "./codec.js";

export const toAccountIdFromAddress = (params: { chainRef: ChainRef; address: string }): AccountId => {
  const { namespace } = parseChainRef(params.chainRef);
  const codec = getAccountCodec(namespace);
  const canonical = codec.toCanonicalAddress({ chainRef: params.chainRef, value: params.address });
  return codec.toAccountId(canonical);
};

export const toCanonicalAddressFromAccountId = (params: { chainRef: ChainRef; accountId: AccountId }): string => {
  const { namespace } = parseChainRef(params.chainRef);
  const codec = getAccountCodec(namespace);
  const canonical = codec.fromAccountId(params.accountId);
  // Return chain-canonical form (eg. EVM lowercased 0x) for stable comparisons/storage.
  return codec.toCanonicalString({ chainRef: params.chainRef, canonical });
};
