import type {
  WalletApiAccountsByKeyringResult,
  WalletApiBackupStatusResult,
  WalletApiKeyringListResult,
} from "@arx/core/wallet";
import type { QueryClient } from "@tanstack/react-query";
import { app } from "@/ui/lib/app";

export const UI_KEYRINGS_QUERY_KEY = ["uiKeyrings"] as const;
export const UI_ACCOUNTS_BY_KEYRING_QUERY_KEY = ["uiAccountsByKeyring"] as const;
export const UI_KEYRING_BACKUP_STATUS_QUERY_KEY = ["uiKeyringBackupStatus"] as const;

const createUiAccountsByKeyringQueryKey = (keyringId: string, includeHidden = false) =>
  [...UI_ACCOUNTS_BY_KEYRING_QUERY_KEY, keyringId, includeHidden] as const;

export const createUiKeyringsQueryOptions = () => ({
  queryKey: UI_KEYRINGS_QUERY_KEY,
  queryFn: (): Promise<WalletApiKeyringListResult> => app.wallet.keyrings.list(),
  staleTime: 30_000,
});

export const createUiKeyringBackupStatusQueryOptions = () => ({
  queryKey: UI_KEYRING_BACKUP_STATUS_QUERY_KEY,
  queryFn: (): Promise<WalletApiBackupStatusResult> => app.wallet.keyrings.getBackupStatus(),
  staleTime: 30_000,
});

export const createUiAccountsByKeyringQueryOptions = (keyringId: string, includeHidden = false) => ({
  queryKey: createUiAccountsByKeyringQueryKey(keyringId, includeHidden),
  queryFn: (): Promise<WalletApiAccountsByKeyringResult> =>
    app.wallet.keyrings.getAccountsByKeyring({ keyringId, includeHidden }),
  staleTime: 15_000,
});

export const refreshUiKeyringBackupStatusIntoCache = async (
  queryClient: QueryClient,
): Promise<WalletApiBackupStatusResult> => {
  const status = await app.wallet.keyrings.getBackupStatus();
  queryClient.setQueryData(UI_KEYRING_BACKUP_STATUS_QUERY_KEY, status);
  return status;
};
