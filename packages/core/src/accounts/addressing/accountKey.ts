import { parseChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type AccountId, AccountIdSchema } from "../../storage/records.js";
import type { AccountCodecRegistry } from "./codec.js";

export type AccountKey = AccountId;

type AccountCodecLookup = Pick<AccountCodecRegistry, "require">;

export const assertAccountKeyMatchesChainRef = (params: { chainRef: ChainRef; accountKey: AccountKey }) => {
  const chainNamespace = parseChainRef(params.chainRef).namespace;
  const accountNamespace = getAccountKeyNamespace(params.accountKey);
  if (chainNamespace !== accountNamespace) {
    throw new Error(
      `AccountKey namespace mismatch: chainRef "${params.chainRef}" belongs to "${chainNamespace}" but accountKey "${params.accountKey}" belongs to "${accountNamespace}"`,
    );
  }
};

export const parseAccountKey = (accountKey: AccountKey): { namespace: string; payloadHex: string } => {
  const parsed = AccountIdSchema.parse(accountKey);
  const separatorIndex = parsed.indexOf(":");
  if (separatorIndex < 0) {
    throw new Error(`Invalid accountKey format: ${parsed}`);
  }

  return {
    namespace: parsed.slice(0, separatorIndex),
    payloadHex: parsed.slice(separatorIndex + 1),
  };
};

export const getAccountKeyNamespace = (accountKey: AccountKey): string => parseAccountKey(accountKey).namespace;

export const toAccountKeyFromAddress = (params: {
  chainRef: ChainRef;
  address: string;
  accountCodecs: AccountCodecLookup;
}): AccountKey => {
  const { namespace } = parseChainRef(params.chainRef);
  const codec = params.accountCodecs.require(namespace);
  const canonical = codec.toCanonicalAddress({ chainRef: params.chainRef, value: params.address });
  return codec.toAccountId(canonical);
};

export const toCanonicalAddressFromAccountKey = (params: {
  accountKey: AccountKey;
  accountCodecs: AccountCodecLookup;
}): string => {
  const { namespace } = parseAccountKey(params.accountKey);
  const codec = params.accountCodecs.require(namespace);
  const canonical = codec.fromAccountId(params.accountKey);
  return codec.toCanonicalString({ canonical });
};

export const toDisplayAddressFromAccountKey = (params: {
  chainRef: ChainRef;
  accountKey: AccountKey;
  accountCodecs: AccountCodecLookup;
}): string => {
  assertAccountKeyMatchesChainRef(params);
  const codec = params.accountCodecs.require(getAccountKeyNamespace(params.accountKey));
  const canonical = codec.fromAccountId(params.accountKey);
  return codec.toDisplayAddress({ chainRef: params.chainRef, canonical });
};
