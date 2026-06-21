import type { UiMethodResult } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export const UI_SETUP_STATUS_QUERY_KEY = ["uiSetupStatus"] as const;

export type UiSetupStatus = {
  session: UiMethodResult<"ui.session.getStatus">;
  onboarding: UiMethodResult<"ui.onboarding.getStatus">;
};

export const createUiSetupStatusQueryOptions = () => ({
  queryKey: UI_SETUP_STATUS_QUERY_KEY,
  queryFn: fetchUiSetupStatus,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export const fetchUiSetupStatus = async (): Promise<UiSetupStatus> => {
  const [session, onboarding] = await Promise.all([uiClient.session.getStatus(), uiClient.onboarding.getStatus()]);
  return { session, onboarding };
};

export const readCachedUiSetupStatus = (queryClient: QueryClient): UiSetupStatus | undefined => {
  return queryClient.getQueryData<UiSetupStatus>(UI_SETUP_STATUS_QUERY_KEY);
};

export const writeCachedUiSetupStatus = (queryClient: QueryClient, status: UiSetupStatus): void => {
  queryClient.setQueryData(UI_SETUP_STATUS_QUERY_KEY, status);
};

export const loadUiSetupStatusIntoCache = async (queryClient: QueryClient): Promise<UiSetupStatus> => {
  return await queryClient.fetchQuery(createUiSetupStatusQueryOptions());
};

export const refreshUiSetupStatusIntoCache = async (queryClient: QueryClient): Promise<UiSetupStatus> => {
  const status = await fetchUiSetupStatus();
  writeCachedUiSetupStatus(queryClient, status);
  return status;
};

export async function getOrFetchUiSetupStatus(
  queryClient: QueryClient,
  opts?: { fresh?: boolean },
): Promise<UiSetupStatus | undefined> {
  const cached = readCachedUiSetupStatus(queryClient);
  if (cached && !opts?.fresh) return cached;

  try {
    return opts?.fresh
      ? await refreshUiSetupStatusIntoCache(queryClient)
      : await loadUiSetupStatusIntoCache(queryClient);
  } catch (error) {
    console.warn("[getOrFetchUiSetupStatus] failed to fetch setup status", error);
    return undefined;
  }
}
