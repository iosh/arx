import { accountIdFromChainAddress } from "../../accounts/addressing/accountId.js";
import { buildAccountAddressingByNamespace, eip155AccountAddressing } from "../../accounts/addressing/addressing.js";

export const DEFAULT_CHAIN_REF = "eip155:10";
export const DEFAULT_FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const DEFAULT_TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const accountAddressing = buildAccountAddressingByNamespace([eip155AccountAddressing]);

export const createDefaultAccountId = (params?: { chainRef?: string; from?: string }) =>
  accountIdFromChainAddress({
    chainRef: params?.chainRef ?? DEFAULT_CHAIN_REF,
    address: params?.from ?? DEFAULT_FROM,
    accountAddressing,
  });
