import type { Account } from "@arx/core/accounts";
import type { HdKeyring, KeySource } from "@arx/core/keyring";

export function getWalletAccounts(accounts: readonly Account[], hdKeyrings: readonly HdKeyring[]) {
  return accounts.filter(
    ({ origin }) => origin.type === "hd" && hdKeyrings.some((keyring) => keyring.hdKeyringId === origin.hdKeyringId),
  );
}

export function groupAccountsBySource(
  accounts: readonly Account[],
  wallets: readonly {
    source: Extract<KeySource, { type: "bip39" }>;
    hdKeyrings: readonly HdKeyring[];
  }[],
) {
  const walletGroups = wallets
    .map(({ source, hdKeyrings }) => ({
      type: "hd" as const,
      id: source.keySourceId,
      createdAt: source.createdAt,
      source,
      hdKeyrings,
      accounts: getWalletAccounts(accounts, hdKeyrings),
    }))
    .filter((group) => group.accounts.length > 0);
  const privateKeyGroups = accounts
    .filter((account) => account.origin.type === "private-key")
    .map((account) => ({
      type: "private-key" as const,
      id: account.accountId,
      createdAt: account.createdAt,
      account,
    }));

  return [...walletGroups, ...privateKeyGroups].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}
