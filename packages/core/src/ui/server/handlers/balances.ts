import type { CoreReadApi } from "../../../read/types.js";
import type { UiHandlers } from "../types.js";

export const createBalancesHandlers = (deps: {
  read: Pick<CoreReadApi, "getNativeBalance">;
}): Pick<UiHandlers, "ui.balances.getNative"> => {
  return {
    "ui.balances.getNative": async (input) => await deps.read.getNativeBalance(input),
  };
};
