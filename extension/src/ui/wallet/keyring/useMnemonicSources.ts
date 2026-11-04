import type { AccountGroup } from "@arx/core/accounts";
import type { KeySource, KeySourceId } from "@arx/core/keyring";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const mnemonicSourcesKey = ["mnemonicSources"] as const;
type MnemonicSource = Extract<KeySource, { type: "bip39" }>;

export function refreshMnemonicSources(queryClient: QueryClient) {
  void queryClient.cancelQueries({ queryKey: mnemonicSourcesKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: mnemonicSourcesKey, exact: true });
}

function useMnemonicSourcesOptions() {
  const { client: wallet } = useWallet();
  return queryOptions({
    queryKey: mnemonicSourcesKey,
    queryFn: async () => (await wallet.keySources.list()).filter((source) => source.type === "bip39"),
  });
}

function findAccountSource(sources: readonly MnemonicSource[], account: AccountGroup | undefined) {
  if (account?.source.type !== "bip39") return null;
  return sources.find((source) => source.keySourceId === account.source.keySourceId) ?? null;
}

export function useMnemonicSources() {
  return useQuery(useMnemonicSourcesOptions());
}

export function useMnemonicSource(account: AccountGroup | undefined) {
  return useQuery({
    ...useMnemonicSourcesOptions(),
    enabled: account?.source.type === "bip39",
    select: (sources) => findAccountSource(sources, account),
  });
}

export function usePendingMnemonicSource(account: AccountGroup | undefined) {
  return useQuery({
    ...useMnemonicSourcesOptions(),
    select: (sources) => {
      const currentSource = findAccountSource(sources, account);
      const pending = sources.filter((source) => source.backupStatus === "pending");
      return pending.find((source) => source.keySourceId === currentSource?.keySourceId) ?? pending[0] ?? null;
    },
  });
}

export function useMnemonicWallet(keySourceId: KeySourceId) {
  return useQuery({
    ...useMnemonicSourcesOptions(),
    select: (sources) => sources.find((source) => source.keySourceId === keySourceId) ?? null,
  });
}
