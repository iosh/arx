import type { AccountGroup } from "@arx/core/accounts";
import type { TFunction } from "i18next";

export function getAccountName(account: AccountGroup, t: TFunction<"wallet">): string {
  return (
    account.alias ?? t("accountName", { number: account.source.type === "bip39" ? account.source.accountIndex + 1 : 1 })
  );
}
