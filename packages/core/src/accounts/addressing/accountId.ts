import type { ChainRef } from "../../chains/ids.js";
import type { AccountId } from "../../storage/records.js";
import {
  getAccountKeyNamespace,
  parseAccountKey,
  toAccountKeyFromAddress,
  toCanonicalAddressFromAccountKey,
  toDisplayAddressFromAccountKey,
} from "./accountKey.js";
import type { AccountCodecRegistry } from "./codec.js";

export const parseAccountId = (accountId: AccountId): { namespace: string; payloadHex: string } =>
  parseAccountKey(accountId);

export const getAccountIdNamespace = (accountId: AccountId): string => getAccountKeyNamespace(accountId);

type AccountCodecLookup = Pick<AccountCodecRegistry, "require">;

export const toAccountIdFromAddress = (params: {
  chainRef: ChainRef;
  address: string;
  accountCodecs: AccountCodecLookup;
}): AccountId => toAccountKeyFromAddress(params);

export const toCanonicalAddressFromAccountId = (params: {
  accountId: AccountId;
  accountCodecs: AccountCodecLookup;
}): string =>
  toCanonicalAddressFromAccountKey({
    accountKey: params.accountId,
    accountCodecs: params.accountCodecs,
  });

export const toDisplayAddressFromAccountId = (params: {
  chainRef: ChainRef;
  accountId: AccountId;
  accountCodecs: AccountCodecLookup;
}): string =>
  toDisplayAddressFromAccountKey({
    chainRef: params.chainRef,
    accountKey: params.accountId,
    accountCodecs: params.accountCodecs,
  });
