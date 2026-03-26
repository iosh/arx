import { parseChainRef } from "../../../chains/caip.js";
import type { UiOwnedAccountSummary } from "../../protocol/schemas.js";
import type { UiAccountsAccess, UiHandlers } from "../types.js";

const toUiOwnedAccountSummary = (account: {
  accountKey: string;
  canonicalAddress: string;
  displayAddress: string;
}): UiOwnedAccountSummary => ({
  accountKey: account.accountKey,
  canonicalAddress: account.canonicalAddress,
  displayAddress: account.displayAddress,
});

export const createAccountsHandlers = (deps: {
  accounts: UiAccountsAccess;
}): Pick<UiHandlers, "ui.accounts.switchActive"> => {
  return {
    "ui.accounts.switchActive": async ({ chainRef, accountKey }) => {
      const { namespace } = parseChainRef(chainRef);
      const active = await deps.accounts.setActiveAccount({
        namespace,
        chainRef,
        accountKey: accountKey ?? null,
      });
      return active ? toUiOwnedAccountSummary(active) : null;
    },
  };
};
