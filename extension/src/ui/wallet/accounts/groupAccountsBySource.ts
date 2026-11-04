import type { AccountGroup } from "@arx/core/accounts";
import type { KeySource, KeySourceId } from "@arx/core/keyring";

type MnemonicSource = Extract<KeySource, { type: "bip39" }>;

export function getWalletAccounts(accounts: readonly AccountGroup[], keySourceId: KeySourceId) {
  return accounts.filter((account) => account.source.type === "bip39" && account.source.keySourceId === keySourceId);
}

export function groupAccountsBySource(accounts: readonly AccountGroup[], wallets: readonly MnemonicSource[]) {
  const walletGroups = wallets
    .map((source) => ({
      type: "hd" as const,
      id: source.keySourceId,
      createdAt: source.createdAt,
      source,
      accounts: getWalletAccounts(accounts, source.keySourceId),
    }))
    .filter((group) => group.accounts.length > 0);
  const privateKeyGroups = accounts
    .filter((account) => account.source.type === "private-key")
    .map((account) => ({
      type: "private-key" as const,
      id: account.accountGroupId,
      createdAt: account.createdAt,
      account,
    }));
  return [...walletGroups, ...privateKeyGroups].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}
