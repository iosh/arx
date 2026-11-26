import type { AccountGroup } from "@arx/core/accounts";
import type { TFunction } from "i18next";

export function getAccountName(group: AccountGroup, t: TFunction<"wallet">): string {
  return group.alias ?? t("accountName", { number: group.source.type === "bip39" ? group.source.accountIndex + 1 : 1 });
}
