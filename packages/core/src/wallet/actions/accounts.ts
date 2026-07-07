import { parseChainRef } from "../../chains/caip.js";
import type { WalletAccounts, WalletNetworks } from "../../engine/types.js";
import type { SwitchActiveAccountInput } from "../api.js";

const buildCurrentChainAccountSummary = (account: {
  accountId: string;
  canonicalAddress: string;
  displayAddress: string;
}) => ({
  accountId: account.accountId,
  canonicalAddress: account.canonicalAddress,
  displayAddress: account.displayAddress,
});

export const createAccountsHandlers = (deps: { accounts: WalletAccounts; networks: WalletNetworks }) => ({
  listCurrentChain: () => {
    const selectedChain = deps.networks.getSelectedChainView();
    const params = {
      namespace: selectedChain.namespace,
      chainRef: selectedChain.chainRef,
    };
    const accountList = deps.accounts.listOwnedForNamespace(params).map(buildCurrentChainAccountSummary);
    const activeAccount = deps.accounts.getActiveAccountForNamespace(params);

    return {
      totalCount: accountList.length,
      list: accountList,
      active: activeAccount ? buildCurrentChainAccountSummary(activeAccount) : null,
    };
  },

  switchActive: async (input: SwitchActiveAccountInput) => {
    const { namespace } = parseChainRef(input.chainRef);
    const active = await deps.accounts.setActiveAccount({
      namespace,
      chainRef: input.chainRef,
      accountId: input.accountId ?? null,
    });

    return active ? buildCurrentChainAccountSummary(active) : null;
  },
});
