import { parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import { type AccountAddressCodecs, getAccountAddressCodec } from "./accountAddressCodec.js";

export type AccountId = string;

export const parseAccountId = (accountId: AccountId): { namespace: string; payload: string } => {
  const separatorIndex = accountId.indexOf(":");

  return {
    namespace: accountId.slice(0, separatorIndex),
    payload: accountId.slice(separatorIndex + 1),
  };
};

export const getAccountIdNamespace = (accountId: AccountId): string => parseAccountId(accountId).namespace;

const accountIdFromParts = (params: { namespace: string; payload: string }): AccountId =>
  `${params.namespace}:${params.payload}`;

export const accountIdFromAddress = (params: {
  chainRef: ChainRef;
  address: string;
  accountAddressCodecs: AccountAddressCodecs;
}): AccountId => {
  const { namespace } = parseChainRef(params.chainRef);
  const codec = getAccountAddressCodec(params.accountAddressCodecs, namespace);
  const payload = codec.toAccountIdPayload({ chainRef: params.chainRef, address: params.address });
  return accountIdFromParts({ namespace, payload });
};

export const addressFromAccountId = (params: {
  chainRef: ChainRef;
  accountId: AccountId;
  accountAddressCodecs: AccountAddressCodecs;
}): string => {
  const { namespace, payload } = parseAccountId(params.accountId);
  return getAccountAddressCodec(params.accountAddressCodecs, namespace).fromAccountIdPayload({
    chainRef: params.chainRef,
    payload,
  });
};
