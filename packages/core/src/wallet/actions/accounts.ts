import { parseChainRef } from "../../chains/caip.js";
import type { SwitchActiveAccountInput } from "../api.js";
import type { WalletApiContext } from "../context.js";

const buildCurrentChainAccountSummary = (account: {
  accountId: string;
  canonicalAddress: string;
  displayAddress: string;
}) => ({
  accountId: account.accountId,
  canonicalAddress: account.canonicalAddress,
  displayAddress: account.displayAddress,
});

export const listAccountsForCurrentChain = (context: WalletApiContext) => {
  const selectedChain = context.networks.getSelectedChainView();
  const params = {
    namespace: selectedChain.namespace,
    chainRef: selectedChain.chainRef,
  };
  const accountList = context.accounts.listOwnedForNamespace(params).map(buildCurrentChainAccountSummary);
  const activeAccount = context.accounts.getActiveAccountForNamespace(params);

  return {
    totalCount: accountList.length,
    list: accountList,
    active: activeAccount ? buildCurrentChainAccountSummary(activeAccount) : null,
  };
};

export const switchActiveAccount = async (context: WalletApiContext, input: SwitchActiveAccountInput) => {
  const { namespace } = parseChainRef(input.chainRef);
  const active = await context.accounts.setActiveAccount({
    namespace,
    chainRef: input.chainRef,
    accountId: input.accountId ?? null,
  });

  return active ? buildCurrentChainAccountSummary(active) : null;
};
