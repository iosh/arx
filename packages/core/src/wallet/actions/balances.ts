import { AccountNotOwnedError } from "../../accounts/errors.js";
import { parseChainRef } from "../../chains/caip.js";
import { ChainNotSupportedError } from "../../chains/errors.js";
import type { WalletAccounts, WalletNetworks, WalletSession } from "../../engine/types.js";
import type { NamespaceRuntimeServices } from "../../namespaces/index.js";
import type { WalletApiNativeBalanceInput } from "../api.js";
import { assertSessionUnlocked } from "./session.js";

export const createBalancesHandlers = (deps: {
  session: Pick<WalletSession, "isUnlocked">;
  accounts: Pick<WalletAccounts, "getOwnedAccount">;
  networks: Pick<WalletNetworks, "findAvailableChainView">;
  namespaceRuntime: Pick<NamespaceRuntimeServices, "ui">;
}) => ({
  getNative: async (input: WalletApiNativeBalanceInput) => {
    assertSessionUnlocked(deps.session);

    const { namespace } = parseChainRef(input.chainRef);
    const chain = deps.networks.findAvailableChainView({ chainRef: input.chainRef });
    if (!chain) {
      throw new ChainNotSupportedError(`Native balance is not supported for chain "${input.chainRef}" yet.`);
    }
    const account = deps.accounts.getOwnedAccount({
      namespace,
      chainRef: input.chainRef,
      accountId: input.accountId,
    });
    if (!account) {
      throw new AccountNotOwnedError({ accountId: input.accountId, chainRef: input.chainRef, namespace });
    }

    const amount = await deps.namespaceRuntime.ui.getNativeBalance({
      chainRef: input.chainRef,
      address: account.canonicalAddress,
    });

    return {
      accountId: account.accountId,
      chainRef: input.chainRef,
      amount: amount.toString(10),
      currency: { ...chain.nativeCurrency },
    };
  },
});
