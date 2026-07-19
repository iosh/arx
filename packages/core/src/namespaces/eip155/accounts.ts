import { formatAccountId, parseAccountId } from "../../accounts/accountId.js";
import type { AccountsNamespaceAdapter } from "../../accounts/namespaceAdapter.js";
import { createEip155AddressFormat } from "./address.js";
import { EIP155_NAMESPACE } from "./constants.js";

const addressFormat = createEip155AddressFormat();

export const eip155AccountsAdapter: AccountsNamespaceAdapter = {
  namespace: EIP155_NAMESPACE,

  accountIdFromAddress({ chainRef, address }) {
    const { canonical } = addressFormat.canonicalize({ chainRef, value: address });
    return formatAccountId({ namespace: EIP155_NAMESPACE, payload: canonical.slice(2) });
  },

  addressForAccountId({ chainRef, accountId }) {
    const canonicalAddress = addressFormat.canonicalize({
      chainRef,
      value: `0x${parseAccountId(accountId).payload}`,
    }).canonical;

    return {
      canonicalAddress,
      displayAddress: addressFormat.format({ chainRef, canonical: canonicalAddress }),
    };
  },
};
