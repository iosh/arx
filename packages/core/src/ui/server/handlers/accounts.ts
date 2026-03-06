import { parseChainRef } from "../../../chains/caip.js";
import type { UiSnapshot } from "../../protocol/schemas.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";

export const createAccountsHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers">,
  buildSnapshot: () => UiSnapshot,
): Pick<UiHandlers, "ui.accounts.switchActive"> => {
  return {
    "ui.accounts.switchActive": async ({ chainRef, address }) => {
      const { namespace } = parseChainRef(chainRef);
      await deps.controllers.accounts.switchActiveForNamespace({
        namespace,
        chainRef,
        address: address ?? null,
      });
      return buildSnapshot().accounts.active;
    },
  };
};
