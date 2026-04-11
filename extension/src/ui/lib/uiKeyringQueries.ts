import type { UiAccountMeta, UiKeyringMeta } from "@arx/core/ui";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export const UI_KEYRINGS_QUERY_KEY = ["uiKeyrings"] as const;
export const UI_ACCOUNTS_BY_KEYRING_QUERY_KEY = ["uiAccountsByKeyring"] as const;

const createUiAccountsByKeyringQueryKey = (keyringId: string, includeHidden = false) =>
  [...UI_ACCOUNTS_BY_KEYRING_QUERY_KEY, keyringId, includeHidden] as const;

export const createUiKeyringsQueryOptions = () => ({
  queryKey: UI_KEYRINGS_QUERY_KEY,
  queryFn: (): Promise<UiKeyringMeta[]> => uiClient.keyrings.list(),
  staleTime: 30_000,
});

export const createUiAccountsByKeyringQueryOptions = (keyringId: string, includeHidden = false) => ({
  queryKey: createUiAccountsByKeyringQueryKey(keyringId, includeHidden),
  queryFn: (): Promise<UiAccountMeta[]> => uiClient.keyrings.getAccountsByKeyring({ keyringId, includeHidden }),
  staleTime: 15_000,
});
