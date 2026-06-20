import { AccountNotOwnedError } from "../accounts/errors.js";
import type { AccountSelectionService } from "../accounts/runtime/types.js";
import { parseChainRef } from "../chains/caip.js";
import { ChainNotSupportedError } from "../chains/errors.js";
import type { NamespaceRuntimeBindingsRegistry } from "../namespaces/types.js";
import { SessionLockedError } from "../runtime/session/errors.js";
import type { ChainViewsService } from "../services/runtime/chainViews/types.js";
import type { SessionStatusService } from "../services/runtime/sessionStatus.js";
import type { CoreReadApi } from "./types.js";

export type CoreNativeBalanceReaderDeps = {
  accounts: Pick<AccountSelectionService, "getOwnedAccount">;
  chainViews: Pick<ChainViewsService, "requireAvailableChainDefinition">;
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getUi">;
  sessionStatus: Pick<SessionStatusService, "isUnlocked">;
};

export const createCoreNativeBalanceReader = (deps: CoreNativeBalanceReaderDeps): CoreReadApi["getNativeBalance"] => {
  return async ({ accountKey, chainRef }) => {
    if (!deps.sessionStatus.isUnlocked()) {
      throw new SessionLockedError();
    }

    const { namespace } = parseChainRef(chainRef);
    const definition = deps.chainViews.requireAvailableChainDefinition(chainRef);
    const account = deps.accounts.getOwnedAccount({ namespace, chainRef, accountKey });
    if (!account) {
      throw new AccountNotOwnedError({ accountKey, chainRef, namespace });
    }

    const uiBindings = deps.namespaceBindings.getUi(namespace);
    if (!uiBindings?.getNativeBalance) {
      throw new ChainNotSupportedError({
        message: `Native balance is not supported for namespace "${namespace}" yet.`,
      });
    }

    const amount = await uiBindings.getNativeBalance({ chainRef, address: account.canonicalAddress });

    return {
      accountKey: account.accountKey,
      chainRef,
      amount: amount.toString(10),
      currency: { ...definition.nativeCurrency },
    };
  };
};
