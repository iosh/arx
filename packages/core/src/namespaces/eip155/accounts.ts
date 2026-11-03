import { Address } from "ox";
import { formatAccountId, parseAccountId } from "../../accounts/accountId.js";
import type { AccountsNamespaceAdapter } from "../../accounts/namespaceAdapter.js";
import * as EvmAddress from "./address.js";
import { EIP155_NAMESPACE } from "./constants.js";

export const eip155AccountsAdapter: AccountsNamespaceAdapter = {
  namespace: EIP155_NAMESPACE,

  accountIdFromAddress({ address }) {
    const canonicalAddress = EvmAddress.parse(address);
    return formatAccountId({ namespace: EIP155_NAMESPACE, payload: canonicalAddress.slice(2) });
  },

  addressForAccountId({ accountId }) {
    const canonicalAddress = EvmAddress.parse(`0x${parseAccountId(accountId).payload}`);

    return {
      canonicalAddress,
      displayAddress: Address.checksum(canonicalAddress),
    };
  },
};
