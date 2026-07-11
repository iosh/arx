import { parseChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type AccountAddressingByNamespace, accountAddressingForNamespace } from "./addressing.js";

export type AccountId = string;

export const parseAccountId = (accountId: AccountId): { namespace: string; payloadHex: string } => {
  const separatorIndex = accountId.indexOf(":");

  return {
    namespace: accountId.slice(0, separatorIndex),
    payloadHex: accountId.slice(separatorIndex + 1),
  };
};

export const getAccountIdNamespace = (accountId: AccountId): string => parseAccountId(accountId).namespace;

const accountIdFromParts = (params: { namespace: string; payloadHex: string }): AccountId =>
  `${params.namespace}:${params.payloadHex}`;

export const accountIdFromChainAddress = (params: {
  chainRef: ChainRef;
  address: string;
  accountAddressing: AccountAddressingByNamespace;
}): AccountId => {
  const { namespace } = parseChainRef(params.chainRef);
  const addressing = accountAddressingForNamespace(params.accountAddressing, namespace);
  const payloadHex = addressing.accountIdPayloadFromAddress({ chainRef: params.chainRef, address: params.address });
  return accountIdFromParts({ namespace, payloadHex });
};

export const canonicalChainAddressFromAccountId = (params: {
  chainRef: ChainRef;
  accountId: AccountId;
  accountAddressing: AccountAddressingByNamespace;
}): string => {
  const { namespace, payloadHex } = parseAccountId(params.accountId);
  const addressing = accountAddressingForNamespace(params.accountAddressing, namespace);
  return addressing.canonicalAddressFromAccountIdPayload({ chainRef: params.chainRef, payloadHex });
};

export const displayChainAddressFromAccountId = (params: {
  chainRef: ChainRef;
  accountId: AccountId;
  accountAddressing: AccountAddressingByNamespace;
}): string => {
  const { payloadHex } = parseAccountId(params.accountId);
  const addressing = accountAddressingForNamespace(params.accountAddressing, getAccountIdNamespace(params.accountId));
  return addressing.displayAddressFromAccountIdPayload({ chainRef: params.chainRef, payloadHex });
};
