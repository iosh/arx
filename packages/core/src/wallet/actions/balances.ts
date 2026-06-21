import { AccountNotOwnedError } from "../../accounts/errors.js";
import { parseChainRef } from "../../chains/caip.js";
import { ChainNotSupportedError } from "../../chains/errors.js";
import { SessionLockedError } from "../../runtime/session/errors.js";
import type { WalletApiNativeBalanceInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiBalancesSchemas } from "../schemas/balances.js";

export const getNativeBalance = async (context: WalletApiContext, input: WalletApiNativeBalanceInput) => {
  const params = WalletApiBalancesSchemas.getNative.parse(input);
  if (!context.session.isUnlocked()) {
    throw new SessionLockedError();
  }

  const { namespace } = parseChainRef(params.chainRef);
  const chain = context.networks.findAvailableChainView({ chainRef: params.chainRef });
  if (!chain) {
    throw new ChainNotSupportedError({
      message: `Native balance is not supported for chain "${params.chainRef}" yet.`,
    });
  }
  const account = context.accounts.getOwnedAccount({
    namespace,
    chainRef: params.chainRef,
    accountKey: params.accountKey,
  });
  if (!account) {
    throw new AccountNotOwnedError({ accountKey: params.accountKey, chainRef: params.chainRef, namespace });
  }

  const uiBindings = context.namespaceBindings.getUi(namespace);
  if (!uiBindings?.getNativeBalance) {
    throw new ChainNotSupportedError({
      message: `Native balance is not supported for namespace "${namespace}" yet.`,
    });
  }

  const amount = await uiBindings.getNativeBalance({ chainRef: params.chainRef, address: account.canonicalAddress });

  return {
    accountKey: account.accountKey,
    chainRef: params.chainRef,
    amount: amount.toString(10),
    currency: { ...chain.nativeCurrency },
  };
};
