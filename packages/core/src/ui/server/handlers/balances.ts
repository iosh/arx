import { ChainNotSupportedError } from "../../../chains/errors.js";
import type { UiChainsAccess, UiHandlers, UiNamespaceBindingsAccess, UiSessionAccess } from "../types.js";
import { assertUnlocked } from "./lib.js";

export const createBalancesHandlers = (deps: {
  chains: UiChainsAccess;
  session: UiSessionAccess;
  namespaceBindings: UiNamespaceBindingsAccess;
}): Pick<UiHandlers, "ui.balances.getNative"> => {
  return {
    "ui.balances.getNative": async ({ chainRef, address }) => {
      assertUnlocked(deps.session);
      const namespace = deps.chains.findAvailableChainView({ chainRef })?.namespace;
      if (!namespace) {
        throw new ChainNotSupportedError({
          message: `Native balance is not supported for chain "${chainRef}" yet.`,
        });
      }
      const uiBindings = deps.namespaceBindings.getUi(namespace);
      if (!uiBindings?.getNativeBalance) {
        throw new ChainNotSupportedError({
          message: `Native balance is not supported for namespace "${namespace}" yet.`,
        });
      }

      const amount = await uiBindings.getNativeBalance({ chainRef, address });

      return { chainRef, address, amountWei: amount.toString(10), fetchedAt: Date.now() };
    },
  };
};
