import { UI_EVENT_ENTRY_CHANGED, type UiSnapshot } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { getUiEnvironment, hydrateUiEntryMetadata, type UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { uiClient } from "./uiBridgeClient";
import { refreshUiSnapshotIntoCache } from "./uiSnapshotQuery";

export const loadUiEntryLaunchContext = async (): Promise<UiEntryMetadata> => {
  const environment = getUiEnvironment();
  const metadata = await uiClient.entry.getLaunchContext({ environment });
  return hydrateUiEntryMetadata(metadata);
};

export const startUiEntryLaunchContextSync = (): (() => void) => {
  const environment = getUiEnvironment();
  let disposed = false;
  let shouldReloadLaunchContext = false;

  const stopEntryChanged = uiClient.on(UI_EVENT_ENTRY_CHANGED, (metadata) => {
    if (metadata.environment !== environment) {
      return;
    }

    hydrateUiEntryMetadata(metadata);
  });

  const stopConnectionStatus = uiClient.onConnectionStatus((status) => {
    if (status === "disconnected") {
      shouldReloadLaunchContext = true;
      return;
    }

    if (!shouldReloadLaunchContext) {
      return;
    }

    shouldReloadLaunchContext = false;

    void uiClient.entry
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

export const preloadUiSnapshot = async (queryClient: QueryClient): Promise<UiSnapshot> => {
  return await refreshUiSnapshotIntoCache(queryClient);
};
