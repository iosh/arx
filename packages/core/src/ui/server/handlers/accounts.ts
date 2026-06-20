import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiOwnedAccountSummary } from "../../protocol/schemas.js";
import type { UiHandlers } from "../types.js";

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
  wallet: TrustedWalletApi;
}): Pick<UiHandlers, "ui.accounts.switchActive"> => {
  return {
    "ui.accounts.switchActive": async (input) => {
      const active = await deps.wallet.accounts.switchActive(input);
      return active ? toUiOwnedAccountSummary(active) : null;
    },
  };
};
