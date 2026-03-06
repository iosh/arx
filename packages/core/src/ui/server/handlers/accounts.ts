import type { UiSnapshot } from "../../protocol/schemas.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";

export const createAccountsHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers">,
  buildSnapshot: () => UiSnapshot,
): Pick<UiHandlers, "ui.accounts.switchActive"> => {
  return {
    "ui.accounts.switchActive": async ({ chainRef, address }) => {
      await deps.controllers.accounts.switchActive({
        chainRef,
        address: address ?? null,
      });
      return buildSnapshot().accounts.active;
    },
  };
};
