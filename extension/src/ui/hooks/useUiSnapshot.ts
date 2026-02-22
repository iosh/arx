import type { UiSnapshot } from "@arx/core/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { uiClient } from "../lib/uiBridgeClient";
import { useUiPort } from "./useUiPort";

// Export query key for route guards to reuse
export const UI_SNAPSHOT_QUERY_KEY = ["uiSnapshot"] as const;
export const UI_KEYRINGS_QUERY_KEY = ["uiKeyrings"] as const;
const UI_ACCOUNTS_BY_KEYRING_QUERY_KEY = (keyringId: string, includeHidden = false) =>
  ["uiAccountsByKeyring", keyringId, includeHidden] as const;
export const useUiSnapshot = () => {
  const queryClient = useQueryClient();

  const invalidateKeyrings = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: UI_KEYRINGS_QUERY_KEY }),
    [queryClient],
  );

  const invalidateAccountsByKeyring = useCallback(
    (keyringId: string) =>
      void queryClient.invalidateQueries({ queryKey: ["uiAccountsByKeyring", keyringId], exact: false }),
    [queryClient],
  );

  const snapshotQuery = useQuery<UiSnapshot>({
    queryKey: UI_SNAPSHOT_QUERY_KEY,
    queryFn: () => uiClient.waitForSnapshot(),
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

  const unlockMutation = useMutation({
    mutationFn: (password: string) => uiClient.session.unlock({ password }),
  });

  const lockMutation = useMutation({
    mutationFn: () => uiClient.session.lock(),
  });

  const resetAutoLockMutation = useMutation({
    mutationFn: () => uiClient.session.resetAutoLockTimer(),
  });

  const switchAccountMutation = useMutation({
    mutationFn: ({ chainRef, address }: { chainRef: string; address?: string | null }) =>
      uiClient.accounts.switchActive({ chainRef, address }),
  });

  const switchChainMutation = useMutation({
    mutationFn: (chainRef: string) => uiClient.networks.switchActive({ chainRef }),
  });

  const approveApprovalMutation = useMutation({
    mutationFn: (id: string) => uiClient.approvals.approve({ id }),
  });

  const rejectApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => uiClient.approvals.reject({ id, reason }),
  });

  const setAutoLockDurationMutation = useMutation({
    mutationFn: (durationMs: number) => uiClient.session.setAutoLockDuration({ durationMs }),
  });

  const deriveAccountMutation = useMutation({
    mutationFn: (params: { keyringId: string }) => uiClient.keyrings.deriveAccount(params),
    onSuccess: (_res, variables) => {
      invalidateAccountsByKeyring(variables.keyringId);
    },
  });

  const importPrivateKeyMutation = useMutation({
    mutationFn: (params: { privateKey: string; alias?: string; namespace?: string }) =>
      uiClient.keyrings.importPrivateKey(params),
    onSuccess: (res) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(res.keyringId);
    },
  });

  const renameKeyringMutation = useMutation({
    mutationFn: (params: { keyringId: string; alias: string }) => uiClient.keyrings.renameKeyring(params),
    onSuccess: (_res, variables) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(variables.keyringId);
    },
  });

  const renameAccountMutation = useMutation({
    mutationFn: (params: { accountId: string; alias: string }) => uiClient.keyrings.renameAccount(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["uiAccountsByKeyring"], exact: false });
    },
  });

  const markBackedUpMutation = useMutation({
    mutationFn: (keyringId: string) => uiClient.keyrings.markBackedUp({ keyringId }),
    onSuccess: (_res, keyringId) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(keyringId);
    },
  });

  const hideHdAccountMutation = useMutation({
    mutationFn: (accountId: string) => uiClient.keyrings.hideHdAccount({ accountId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["uiAccountsByKeyring"], exact: false });
    },
  });

  const unhideHdAccountMutation = useMutation({
    mutationFn: (accountId: string) => uiClient.keyrings.unhideHdAccount({ accountId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["uiAccountsByKeyring"], exact: false });
    },
  });

  const removePrivateKeyKeyringMutation = useMutation({
    mutationFn: (keyringId: string) => uiClient.keyrings.removePrivateKeyKeyring({ keyringId }),
    onSuccess: (_res, keyringId) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(keyringId);
    },
  });

  const exportMnemonicMutation = useMutation({
    mutationFn: (params: { keyringId: string; password: string }) => uiClient.keyrings.exportMnemonic(params),
  });

  const exportPrivateKeyMutation = useMutation({
    mutationFn: (params: { accountId: string; password: string }) => uiClient.keyrings.exportPrivateKey(params),
  });

  const fetchKeyrings = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: UI_KEYRINGS_QUERY_KEY,
        queryFn: () => uiClient.keyrings.list(),
        staleTime: 30_000,
      }),
    [queryClient],
  );

  const fetchAccountsByKeyring = useCallback(
    (keyringId: string, includeHidden = false) =>
      queryClient.fetchQuery({
        queryKey: UI_ACCOUNTS_BY_KEYRING_QUERY_KEY(keyringId, includeHidden),
        queryFn: () => uiClient.keyrings.getAccountsByKeyring({ keyringId, includeHidden }),
        staleTime: 15_000,
      }),
    [queryClient],
  );

  return {
    snapshot: snapshotQuery.data,
    isLoading: snapshotQuery.isLoading,
    error: snapshotQuery.error,
    unlock: unlockMutation.mutateAsync,
    lock: lockMutation.mutateAsync,
    resetAutoLockTimer: resetAutoLockMutation.mutate,
    switchAccount: switchAccountMutation.mutateAsync,
    switchChain: switchChainMutation.mutateAsync,
    approveApproval: approveApprovalMutation.mutateAsync,
    rejectApproval: rejectApprovalMutation.mutateAsync,
    setAutoLockDuration: setAutoLockDurationMutation.mutateAsync,
    deriveAccount: deriveAccountMutation.mutateAsync,
    importPrivateKey: importPrivateKeyMutation.mutateAsync,
    renameKeyring: renameKeyringMutation.mutateAsync,
    renameAccount: renameAccountMutation.mutateAsync,
    markBackedUp: markBackedUpMutation.mutateAsync,
    hideHdAccount: hideHdAccountMutation.mutateAsync,
    unhideHdAccount: unhideHdAccountMutation.mutateAsync,
    removePrivateKeyKeyring: removePrivateKeyKeyringMutation.mutateAsync,
    exportMnemonic: exportMnemonicMutation.mutateAsync,
    exportPrivateKey: exportPrivateKeyMutation.mutateAsync,
    fetchKeyrings,
    fetchAccountsByKeyring,
  };
};
