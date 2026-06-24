import { AccountNotOwnedError } from "../../accounts/errors.js";
import { parseChainRef } from "../../chains/caip.js";
import { ChainNotSupportedError } from "../../chains/errors.js";
import { SessionLockedError } from "../../runtime/session/errors.js";
import type { WalletApiNativeBalanceInput } from "../api.js";
import type { WalletApiContext } from "../context.js";

export const getNativeBalance = async (context: WalletApiContext, input: WalletApiNativeBalanceInput) => {
  if (!context.session.isUnlocked()) {
    throw new SessionLockedError();
  }

  const { namespace } = parseChainRef(input.chainRef);
  const chain = context.networks.findAvailableChainView({ chainRef: input.chainRef });
  if (!chain) {
    throw new ChainNotSupportedError({
      message: `Native balance is not supported for chain "${input.chainRef}" yet.`,
    });
  }
  const account = context.accounts.getOwnedAccount({
    namespace,
    chainRef: input.chainRef,
    accountKey: input.accountKey,
  });
  if (!account) {
    throw new AccountNotOwnedError({ accountKey: input.accountKey, chainRef: input.chainRef, namespace });
  }

  const uiBindings = context.namespaceBindings.getUi(namespace);
  if (!uiBindings?.getNativeBalance) {
    throw new ChainNotSupportedError({
      message: `Native balance is not supported for namespace "${namespace}" yet.`,
    });
  }

  const amount = await uiBindings.getNativeBalance({ chainRef: input.chainRef, address: account.canonicalAddress });

  return {
    accountKey: account.accountKey,
    chainRef: input.chainRef,
    amount: amount.toString(10),
    currency: { ...chain.nativeCurrency },
  };
};
