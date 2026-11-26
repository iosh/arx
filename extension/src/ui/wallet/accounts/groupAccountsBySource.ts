import type { AccountGroup } from "@arx/core/accounts";
import type { KeySource, KeySourceId } from "@arx/core/keyring";

type MnemonicSource = Extract<KeySource, { type: "bip39" }>;

export function getWalletAccounts(accountGroups: readonly AccountGroup[], keySourceId: KeySourceId) {
  return accountGroups.filter((group) => group.source.type === "bip39" && group.source.keySourceId === keySourceId);
}

export function groupAccountsBySource(
  accountGroups: readonly AccountGroup[],
  wallets: readonly MnemonicSource[] | undefined,
) {
  const walletGroups =
    wallets
      ?.map((source) => ({
        type: "hd" as const,
        id: source.keySourceId,
        createdAt: source.createdAt,
        source,
        accountGroups: getWalletAccounts(accountGroups, source.keySourceId),
      }))
      .filter((group) => group.accountGroups.length > 0) ?? [];
  const privateKeyGroups = accountGroups
    .filter((group) => group.source.type === "private-key")
    .map((accountGroup) => ({
      type: "private-key" as const,
      id: accountGroup.accountGroupId,
      createdAt: accountGroup.createdAt,
      accountGroup,
    }));
  return [...walletGroups, ...privateKeyGroups].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}
