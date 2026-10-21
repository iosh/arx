import type { Account } from "@arx/core/accounts";
import type { TFunction } from "i18next";

export function getAccountName(account: Account, t: TFunction<"wallet">): string {
  return (
    account.alias ?? t("accountName", { number: account.origin.type === "hd" ? account.origin.derivationIndex + 1 : 1 })
  );
}
