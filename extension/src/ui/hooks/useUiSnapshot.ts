import type { UiSnapshot } from "@arx/core/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { uiClient } from "../lib/uiClient";
import { useUiPort } from "./useUiPort";

// Export query key for route guards to reuse
export const UI_SNAPSHOT_QUERY_KEY = ["uiSnapshot"] as const;

export const useUiSnapshot = () => {
  const queryClient = useQueryClient();

  const snapshotQuery = useQuery<UiSnapshot>({
    queryKey: UI_SNAPSHOT_QUERY_KEY,
    queryFn: () => uiClient.getSnapshot(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Stable callback reference to avoid effect re-execution
  const handleSnapshot = useCallback(
    (snapshot: UiSnapshot) => {
      queryClient.setQueryData(UI_SNAPSHOT_QUERY_KEY, snapshot);
    },
    [queryClient],
  );

  useUiPort(handleSnapshot);

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: UI_SNAPSHOT_QUERY_KEY }),
    [queryClient],
  );

  const unlockMutation = useMutation({
    mutationFn: (password: string) => uiClient.unlock(password),
    onSuccess: invalidate,
  });

  const vaultInitMutation = useMutation({
    mutationFn: (password: string) => uiClient.vaultInit(password),
    onSuccess: invalidate,
  });

  const lockMutation = useMutation({
    mutationFn: () => uiClient.lock(),
    onSuccess: invalidate,
  });

  const resetAutoLockMutation = useMutation({
    mutationFn: () => uiClient.resetAutoLockTimer(),
  });

  const switchAccountMutation = useMutation({
    mutationFn: ({ chainRef, address }: { chainRef: string; address?: string | null }) =>
      uiClient.switchAccount(chainRef, address),
    onSuccess: invalidate,
  });

  const switchChainMutation = useMutation({
    mutationFn: (chainRef: string) => uiClient.switchChain(chainRef),
    onSuccess: invalidate,
  });

  const approveApprovalMutation = useMutation({
    mutationFn: (id: string) => uiClient.approveApproval(id),
    onSuccess: invalidate,
  });

  const rejectApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => uiClient.rejectApproval(id, reason),
    onSuccess: invalidate,
  });

  const setAutoLockDurationMutation = useMutation({
    mutationFn: (durationMs: number) => uiClient.setAutoLockDuration(durationMs),
    onSuccess: (data) => {
      queryClient.setQueryData<UiSnapshot>(UI_SNAPSHOT_QUERY_KEY, (prev) =>
        prev
          ? {
              ...prev,
              session: {
                ...prev.session,
                autoLockDurationMs: data.autoLockDurationMs,
                nextAutoLockAt: data.nextAutoLockAt,
              },
            }
          : prev,
      );
    },
  });

  return {
    snapshot: snapshotQuery.data,
    isLoading: snapshotQuery.isLoading,
    error: snapshotQuery.error,
    unlock: unlockMutation.mutateAsync,
    vaultInit: vaultInitMutation.mutateAsync,
    lock: lockMutation.mutateAsync,
    resetAutoLockTimer: resetAutoLockMutation.mutate,
    switchAccount: switchAccountMutation.mutateAsync,
    switchChain: switchChainMutation.mutateAsync,
    approveApproval: approveApprovalMutation.mutateAsync,
    rejectApproval: rejectApprovalMutation.mutateAsync,
    setAutoLockDuration: setAutoLockDurationMutation.mutateAsync,
  };
};
