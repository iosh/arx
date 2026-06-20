import type { WalletApiContext } from "../context.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";

export const selectCreatedAccount = async (
  context: WalletApiContext,
  params: { namespace?: string; address: string },
) => {
  const namespace = params.namespace ?? context.networks.getSelectedNamespace();
  const chainRef = getSelectedWalletChainRefForNamespace(context, namespace);
  await context.accounts.setActiveAccount({
    namespace,
    chainRef,
    accountKey: context.accountCodecs.toAccountKeyFromAddress({
      chainRef,
      address: params.address,
    }),
  });
};
