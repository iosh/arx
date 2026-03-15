import { parseChainRef } from "../../../chains/caip.js";
import type { UiOwnedAccountSummary } from "../../protocol/schemas.js";
import type { UiHandlers, UiRuntimeDeps } from "../types.js";

const toUiOwnedAccountSummary = (account: {
  accountId: string;
  canonicalAddress: string;
  displayAddress: string;
}): UiOwnedAccountSummary => ({
  accountId: account.accountId,
  canonicalAddress: account.canonicalAddress,
  displayAddress: account.displayAddress,
});

export const createAccountsHandlers = (
  deps: Pick<UiRuntimeDeps, "accounts">,
): Pick<UiHandlers, "ui.accounts.switchActive"> => {
  return {
    "ui.accounts.switchActive": async ({ chainRef, accountId }) => {
      const { namespace } = parseChainRef(chainRef);
      const active = await deps.accounts.setActiveAccount({
        namespace,
        chainRef,
        accountId: accountId ?? null,
      });
      return active ? toUiOwnedAccountSummary(active) : null;
    },
  };
};
