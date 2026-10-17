import type { Account } from "@arx/core/accounts";
import type { HdKeyring, KeySource, KeySourceId } from "@arx/core/keyring";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "./useWalletEvents";
import { useWallet } from "./WalletContext";

const mnemonicSourcesKey = ["mnemonicSources"] as const;

type MnemonicSource = Extract<KeySource, { type: "bip39" }>;

type MnemonicSources = Readonly<{
  sources: readonly MnemonicSource[];
  hdKeyrings: readonly HdKeyring[];
}>;

function groupAccountsBySource(accounts: readonly Account[], hdKeyrings: readonly HdKeyring[]) {
  const sourceByKeyring = new Map(hdKeyrings.map((keyring) => [keyring.hdKeyringId, keyring.keySourceId]));
  const accountsBySource = new Map<KeySourceId, Account[]>();

  for (const account of accounts) {
    if (account.origin.type !== "hd") continue;
    const keySourceId = sourceByKeyring.get(account.origin.hdKeyringId);
    if (keySourceId === undefined) continue;

    const sourceAccounts = accountsBySource.get(keySourceId);
    if (sourceAccounts) sourceAccounts.push(account);
    else accountsBySource.set(keySourceId, [account]);
  }

  return accountsBySource;
}

function useMnemonicSources<TData>({
  enabled,
  select,
}: {
  enabled: boolean;
  select: (data: MnemonicSources) => TData;
}) {
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();

  useWalletEvents(wallet, "keyringChanged", () => {
    // Ignore an older response if the keyring changes while this query is in flight.
    void queryClient.cancelQueries({ queryKey: mnemonicSourcesKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: mnemonicSourcesKey, exact: true });
  });

  return useQuery({
    queryKey: mnemonicSourcesKey,
    queryFn: async () => {
      // HD accounts reference a keyring, which links them to their mnemonic source.
      const [keySources, hdKeyrings] = await Promise.all([wallet.keySources.list(), wallet.hdKeyrings.list()]);
      return {
        sources: keySources.filter((source) => source.type === "bip39"),
        hdKeyrings,
      };
    },
    enabled,
    select,
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useMnemonicSource(account: Account | undefined) {
  const hdKeyringId = account?.origin.type === "hd" ? account.origin.hdKeyringId : null;

  return useMnemonicSources({
    enabled: hdKeyringId !== null,
    select: ({ sources, hdKeyrings }) => {
      const keySourceId = hdKeyrings.find((keyring) => keyring.hdKeyringId === hdKeyringId)?.keySourceId;
      return sources.find((source) => source.keySourceId === keySourceId) ?? null;
    },
  });
}

export function useMnemonicWallet(keySourceId: KeySourceId, accounts: readonly Account[] | undefined) {
  return useMnemonicSources({
    enabled: true,
    select: ({ sources, hdKeyrings }) => {
      const source = sources.find((source) => source.keySourceId === keySourceId);
      if (!source) return null;

      return {
        source,
        accounts: accounts ? (groupAccountsBySource(accounts, hdKeyrings).get(keySourceId) ?? []) : undefined,
      };
    },
  });
}

export function useMnemonicWallets(accounts: readonly Account[] | undefined) {
  return useMnemonicSources({
    enabled: accounts?.some((account) => account.origin.type === "hd") ?? false,
    select: ({ sources, hdKeyrings }) => {
      if (!accounts) return [];
      const accountsBySource = groupAccountsBySource(accounts, hdKeyrings);
      return sources
        .map((source) => ({
          source,
          accounts: accountsBySource.get(source.keySourceId) ?? [],
        }))
        .filter((wallet) => wallet.accounts.length > 0);
    },
  });
}
