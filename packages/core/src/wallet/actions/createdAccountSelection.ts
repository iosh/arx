import { accountIdFromChainAddress } from "../../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import type { WalletAccounts, WalletNetworks } from "../../engine/types.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";

export const selectCreatedAccount = async (
  deps: {
    accounts: Pick<WalletAccounts, "setActiveAccount">;
    networks: Pick<WalletNetworks, "getSelectedNamespace" | "getSelectedChainRef" | "getActiveChainViewForNamespace">;
    accountAddressing: AccountAddressingByNamespace;
  },
  params: { namespace?: string; address: string },
) => {
  const namespace = params.namespace ?? deps.networks.getSelectedNamespace();
  const chainRef = getSelectedWalletChainRefForNamespace(deps.networks, namespace);
  await deps.accounts.setActiveAccount({
    namespace,
    chainRef,
    accountId: accountIdFromChainAddress({
      accountAddressing: deps.accountAddressing,
      chainRef,
      address: params.address,
    }),
  });
};
