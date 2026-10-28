import type { Account } from "@arx/core/accounts";
import type { HdKeyring, KeySource, KeySourceId } from "@arx/core/keyring";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const mnemonicSourcesKey = ["mnemonicSources"] as const;

type MnemonicSource = Extract<KeySource, { type: "bip39" }>;

type MnemonicSources = Readonly<{
  sources: readonly MnemonicSource[];
  hdKeyrings: readonly HdKeyring[];
}>;

export function refreshMnemonicSources(queryClient: QueryClient) {
  // Ignore an older response if the keyring changes while this query is in flight.
  void queryClient.cancelQueries({ queryKey: mnemonicSourcesKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: mnemonicSourcesKey, exact: true });
}

function useMnemonicSourcesOptions() {
  const { client: wallet } = useWallet();
  return queryOptions({
    queryKey: mnemonicSourcesKey,
    queryFn: async () => {
      // HD accounts reference a keyring, which links them to their mnemonic source.
      const [keySources, hdKeyrings] = await Promise.all([wallet.keySources.list(), wallet.hdKeyrings.list()]);
      return {
        sources: keySources.filter((source) => source.type === "bip39"),
        hdKeyrings,
      };
    },
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}

function findAccountSource({ sources, hdKeyrings }: MnemonicSources, account: Account | undefined) {
  if (account?.origin.type !== "hd") return null;
  const hdKeyringId = account.origin.hdKeyringId;
  const keySourceId = hdKeyrings.find((keyring) => keyring.hdKeyringId === hdKeyringId)?.keySourceId;
  return sources.find((source) => source.keySourceId === keySourceId) ?? null;
}

export function useMnemonicSource(account: Account | undefined) {
  return useQuery({
    ...useMnemonicSourcesOptions(),
    enabled: account?.origin.type === "hd",
    select: (data) => findAccountSource(data, account),
  });
}

export function useMnemonicWallet(keySourceId: KeySourceId) {
  return useQuery({
    ...useMnemonicSourcesOptions(),
    select: ({ sources, hdKeyrings }) => {
      const source = sources.find((source) => source.keySourceId === keySourceId);
      if (!source) return null;
      return {
        source,
        hdKeyrings: hdKeyrings.filter((keyring) => keyring.keySourceId === keySourceId),
      };
    },
  });
}

export function useHdWallets() {
  return useQuery({
    ...useMnemonicSourcesOptions(),
    select: ({ sources, hdKeyrings }) =>
      sources.flatMap((source) => {
        const sourceKeyrings = hdKeyrings.filter((candidate) => candidate.keySourceId === source.keySourceId);
        return sourceKeyrings.length > 0 ? [{ source, hdKeyrings: sourceKeyrings }] : [];
      }),
  });
}
