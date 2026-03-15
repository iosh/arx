import { ArxReasons, arxError } from "@arx/errors";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { assertUnlocked } from "./lib.js";

export const createBalancesHandlers = (
  deps: Pick<UiRuntimeDeps, "chains" | "session" | "namespaceBindings">,
): Pick<UiHandlers, "ui.balances.getNative"> => {
  return {
    "ui.balances.getNative": async ({ chainRef, address }) => {
      assertUnlocked(deps.session);
      const chain = deps.chains.requireAvailableChainMetadata(chainRef);
      const uiBindings = deps.namespaceBindings.getUi(chain.namespace);
      if (!uiBindings?.getNativeBalance) {
        throw arxError({
          reason: ArxReasons.ChainNotSupported,
          message: `Native balance is not supported for namespace "${chain.namespace}" yet.`,
          data: { chainRef, namespace: chain.namespace },
        });
      }

      const amount = await uiBindings.getNativeBalance({ chainRef, address });

      return { chainRef, address, amountWei: amount.toString(10), fetchedAt: Date.now() };
    },
  };
};
