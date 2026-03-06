import { parseChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type AccountId, AccountIdSchema } from "../../storage/records.js";
import { getAccountCodec } from "./codec.js";

export const parseAccountId = (accountId: AccountId): { namespace: string; payloadHex: string } => {
  const parsed = AccountIdSchema.parse(accountId);
  const separatorIndex = parsed.indexOf(":");
  if (separatorIndex < 0) {
    throw new Error(`Invalid accountId format: ${parsed}`);
  }

  return {
    namespace: parsed.slice(0, separatorIndex),
    payloadHex: parsed.slice(separatorIndex + 1),
  };
};

export const getAccountIdNamespace = (accountId: AccountId): string => parseAccountId(accountId).namespace;

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
  return codec.toCanonicalString({ chainRef: params.chainRef, canonical });
};

export const toDisplayAddressFromAccountId = (params: { chainRef: ChainRef; accountId: AccountId }): string => {
  const { namespace } = parseChainRef(params.chainRef);
  const codec = getAccountCodec(namespace);
  const canonical = codec.fromAccountId(params.accountId);
  return codec.toDisplayAddress({ chainRef: params.chainRef, canonical });
};
