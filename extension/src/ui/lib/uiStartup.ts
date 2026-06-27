import type { QueryClient } from "@tanstack/react-query";
import type { UiEntryBootstrap } from "@/lib/host";
import { getUiEnvironment, hydrateUiEntryMetadata, type UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { app } from "./app";
import { writeCachedUiApprovalDetail } from "./uiApprovalQueries";

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

export const startUiEntryLaunchContextSync = (): (() => void) => {
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

    void app.host.entry
      .getLaunchContext({ environment })
      .then((metadata) => {
        if (disposed) {
          return;
        }

        hydrateUiEntryMetadata(metadata);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        console.warn("[uiStartup] failed to refresh launch context after reconnect", error);
      });
  });

  return () => {
    disposed = true;
    stopConnectionStatus();
    stopEntryChanged();
  };
};
