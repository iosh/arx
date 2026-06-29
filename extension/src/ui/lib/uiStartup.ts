import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { UiEntryBootstrap } from "@/lib/host";
import { getUiEnvironment, hydrateUiEntryMetadata, type UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { app } from "./app";
import { UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY } from "./uiAccountQueries";
import { UI_APPROVALS_QUERY_KEY, writeCachedUiApprovalDetail } from "./uiApprovalQueries";
import { UI_NATIVE_BALANCE_QUERY_KEY } from "./uiBalanceQueries";
import {
  UI_ACCOUNTS_BY_KEYRING_QUERY_KEY,
  UI_KEYRING_BACKUP_STATUS_QUERY_KEY,
  UI_KEYRINGS_QUERY_KEY,
} from "./uiKeyringQueries";
import { UI_NETWORKS_QUERY_KEY } from "./uiNetworkQueries";
import { refreshUiSetupStatusIntoCache } from "./uiSetupStatusQuery";

const reconnectInvalidationQueryKeys: readonly QueryKey[] = [
  UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY,
  UI_NETWORKS_QUERY_KEY,
  UI_APPROVALS_QUERY_KEY,
  UI_NATIVE_BALANCE_QUERY_KEY,
  UI_KEYRINGS_QUERY_KEY,
  UI_KEYRING_BACKUP_STATUS_QUERY_KEY,
  UI_ACCOUNTS_BY_KEYRING_QUERY_KEY,
] as const;

export const loadUiEntryLaunchContext = async (): Promise<UiEntryMetadata> => {
  const environment = getUiEnvironment();
  const metadata = await app.host.entry.getLaunchContext({ environment });
  return hydrateUiEntryMetadata(metadata);
};

export const loadUiEntryBootstrap = async (queryClient: QueryClient): Promise<UiEntryBootstrap> => {
  const environment = getUiEnvironment();
  const bootstrap = await app.host.entry.getBootstrap({ environment });

  hydrateUiEntryMetadata(bootstrap.entry);

  if (bootstrap.requestedApproval) {
    writeCachedUiApprovalDetail(queryClient, {
      approvalId: bootstrap.requestedApproval.approvalId,
      detail: bootstrap.requestedApproval.initialDetail,
    });
  }

  return bootstrap;
};

const refreshWalletQueriesAfterReconnect = async (queryClient: QueryClient): Promise<void> => {
  await refreshUiSetupStatusIntoCache(queryClient);
  await Promise.all(reconnectInvalidationQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
};

export const startUiEntryLaunchContextSync = (queryClient: QueryClient): (() => void) => {
  const environment = getUiEnvironment();
  let disposed = false;
  let shouldReloadLaunchContext = false;

  const stopEntryChanged = app.hostEvents.subscribeEntryChanged((metadata) => {
    if (metadata.environment !== environment) {
      return;
    }

    hydrateUiEntryMetadata(metadata);
  });

  const stopConnectionStatus = app.onConnectionStatus((status) => {
    if (status === "disconnected") {
      shouldReloadLaunchContext = true;
      return;
    }

    if (!shouldReloadLaunchContext) {
      return;
    }

    shouldReloadLaunchContext = false;

    void Promise.all([
      app.host.entry.getLaunchContext({ environment }),
      refreshWalletQueriesAfterReconnect(queryClient),
    ])
      .then(([metadata]) => {
        if (disposed) {
          return;
        }

        hydrateUiEntryMetadata(metadata);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        console.warn("[uiStartup] failed to refresh UI state after reconnect", error);
      });
  });

  return () => {
    disposed = true;
    stopConnectionStatus();
    stopEntryChanged();
  };
};
