import { parseChainRef } from "../../chains/caip.js";
import type { SwitchActiveAccountInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiAccountsSchemas } from "../schemas/accounts.js";

const buildCurrentChainAccountSummary = (account: {
  accountKey: string;
  canonicalAddress: string;
  displayAddress: string;
}) => ({
  accountKey: account.accountKey,
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
  const params = WalletApiAccountsSchemas.switchActive.parse(input);
  const { namespace } = parseChainRef(params.chainRef);
  const active = await context.accounts.setActiveAccount({
    namespace,
    chainRef: params.chainRef,
    accountKey: params.accountKey ?? null,
  });

  return active ? buildCurrentChainAccountSummary(active) : null;
};
