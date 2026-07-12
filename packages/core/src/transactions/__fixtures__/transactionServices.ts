import { accountIdFromAddress } from "../../accounts/accountId.js";
import { eip155AccountAddressCodec } from "../../namespaces/eip155/accountAddressCodec.js";

export const DEFAULT_CHAIN_REF = "eip155:10";
export const DEFAULT_FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const DEFAULT_TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const accountAddressCodecs = new Map([["eip155", eip155AccountAddressCodec]]);

export const createDefaultAccountId = (params?: { chainRef?: string; from?: string }) =>
  accountIdFromAddress({
    chainRef: params?.chainRef ?? DEFAULT_CHAIN_REF,
    address: params?.from ?? DEFAULT_FROM,
    accountAddressCodecs,
  });
