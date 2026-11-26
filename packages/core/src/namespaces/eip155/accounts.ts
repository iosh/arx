import { Address } from "ox";
import { type AccountId, formatAccountId, parseAccountId } from "../../accounts/accountId.js";
import type { AccountsNamespaceAdapter } from "../../accounts/namespaceAdapter.js";
import { EIP155_NAMESPACE } from "./constants.js";

/** The address has already been decoded at the dapp boundary or derived from a key. */
export const accountIdFromAddress = (address: string): AccountId =>
  formatAccountId({ namespace: EIP155_NAMESPACE, payload: address.slice(2).toLowerCase() });

const addressForAccountId = ({ accountId }: { accountId: AccountId }) => {
  const canonicalAddress: Address.Address = `0x${parseAccountId(accountId).payload}`;
  return { canonicalAddress, displayAddress: Address.checksum(canonicalAddress) };
};

export const eip155AccountsAdapter: AccountsNamespaceAdapter = {
  namespace: EIP155_NAMESPACE,
  addressForAccountId,
};
