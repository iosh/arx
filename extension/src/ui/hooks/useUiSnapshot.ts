import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UiSnapshot } from "@arx/core/ui";
import { uiClient } from "../lib/uiClient";
import { useUiPort } from "./useUiPort";

const QUERY_KEY = ["uiSnapshot"] as const;

export const useUiSnapshot = () => {
  const queryClient = useQueryClient();

  const snapshotQuery = useQuery<UiSnapshot>({
    queryKey: QUERY_KEY,
    queryFn: () => uiClient.getSnapshot(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Stable callback reference to avoid effect re-execution
  const handleSnapshot = useCallback(
    (snapshot: UiSnapshot) => {
      queryClient.setQueryData(QUERY_KEY, snapshot);
    },
    [queryClient],
  );

  useUiPort(handleSnapshot);

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
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
  };
};
