import type { UiSnapshot } from "@arx/core/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { uiClient } from "../lib/uiClient";
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
    mutationFn: (password: string) => uiClient.unlock(password),
  });

  const vaultInitMutation = useMutation({
    mutationFn: (password: string) => uiClient.vaultInit(password),
  });

  const vaultInitAndUnlockMutation = useMutation({
    mutationFn: (password: string) => uiClient.vaultInitAndUnlock(password),
  });

  const lockMutation = useMutation({
    mutationFn: () => uiClient.lock(),
  });

  const resetAutoLockMutation = useMutation({
    mutationFn: () => uiClient.resetAutoLockTimer(),
  });

  const switchAccountMutation = useMutation({
    mutationFn: ({ chainRef, address }: { chainRef: string; address?: string | null }) =>
      uiClient.switchAccount(chainRef, address),
  });

  const switchChainMutation = useMutation({
    mutationFn: (chainRef: string) => uiClient.switchChain(chainRef),
  });

  const approveApprovalMutation = useMutation({
    mutationFn: (id: string) => uiClient.approveApproval(id),
  });

  const rejectApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => uiClient.rejectApproval(id, reason),
  });

  const setAutoLockDurationMutation = useMutation({
    mutationFn: (durationMs: number) => uiClient.setAutoLockDuration(durationMs),
  });

  const generateMnemonicMutation = useMutation({
    mutationFn: (wordCount?: 12 | 24) => uiClient.generateMnemonic(wordCount),
  });

  const confirmNewMnemonicMutation = useMutation({
    mutationFn: (params: { words: string[]; alias?: string; skipBackup?: boolean; namespace?: string }) =>
      uiClient.confirmNewMnemonic(params),
    onSuccess: (result) => {
      invalidateKeyrings();
      if (result?.keyringId) invalidateAccountsByKeyring(result.keyringId);
    },
  });

  const importMnemonicMutation = useMutation({
    mutationFn: (params: { words: string[]; alias?: string; namespace?: string }) => uiClient.importMnemonic(params),
    onSuccess: (result) => {
      invalidateKeyrings();
      if (result?.keyringId) invalidateAccountsByKeyring(result.keyringId);
    },
  });

  const importPrivateKeyMutation = useMutation({
    mutationFn: (params: { privateKey: string; alias?: string; namespace?: string }) =>
      uiClient.importPrivateKey(params),
    onSuccess: (result) => {
      invalidateKeyrings();
      if (result?.keyringId) invalidateAccountsByKeyring(result.keyringId);
    },
  });

  const deriveAccountMutation = useMutation({
    mutationFn: (params: { keyringId: string }) => uiClient.deriveAccount(params.keyringId),
    onSuccess: (_res, variables) => {
      invalidateAccountsByKeyring(variables.keyringId);
    },
  });

  const renameKeyringMutation = useMutation({
    mutationFn: (params: { keyringId: string; alias: string }) => uiClient.renameKeyring(params),
    onSuccess: (_res, variables) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(variables.keyringId);
    },
  });

  const renameAccountMutation = useMutation({
    mutationFn: (params: { address: string; alias: string }) => uiClient.renameAccount(params),
  });

  const markBackedUpMutation = useMutation({
    mutationFn: (keyringId: string) => uiClient.markBackedUp(keyringId),
    onSuccess: (_res, keyringId) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(keyringId);
    },
  });

  const hideHdAccountMutation = useMutation({
    mutationFn: (address: string) => uiClient.hideHdAccount(address),
  });

  const unhideHdAccountMutation = useMutation({
    mutationFn: (address: string) => uiClient.unhideHdAccount(address),
  });

  const removePrivateKeyKeyringMutation = useMutation({
    mutationFn: (keyringId: string) => uiClient.removePrivateKeyKeyring(keyringId),
    onSuccess: (_res, keyringId) => {
      invalidateKeyrings();
      invalidateAccountsByKeyring(keyringId);
    },
  });

  const exportMnemonicMutation = useMutation({
    mutationFn: (params: { keyringId: string; password: string }) => uiClient.exportMnemonic(params),
  });

  const exportPrivateKeyMutation = useMutation({
    mutationFn: (params: { address: string; password: string }) => uiClient.exportPrivateKey(params),
  });

  const fetchKeyrings = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: UI_KEYRINGS_QUERY_KEY,
        queryFn: () => uiClient.getKeyrings(),
        staleTime: 30_000,
      }),
    [queryClient],
  );

  const fetchAccountsByKeyring = useCallback(
    (keyringId: string, includeHidden = false) =>
      queryClient.fetchQuery({
        queryKey: UI_ACCOUNTS_BY_KEYRING_QUERY_KEY(keyringId, includeHidden),
        queryFn: () => uiClient.getAccountsByKeyring({ keyringId, includeHidden }),
        staleTime: 15_000,
      }),
    [queryClient],
  );

  return {
    snapshot: snapshotQuery.data,
    isLoading: snapshotQuery.isLoading,
    error: snapshotQuery.error,
    unlock: unlockMutation.mutateAsync,
    vaultInit: vaultInitMutation.mutateAsync,
    vaultInitAndUnlock: vaultInitAndUnlockMutation.mutateAsync,
    lock: lockMutation.mutateAsync,
    resetAutoLockTimer: resetAutoLockMutation.mutate,
    switchAccount: switchAccountMutation.mutateAsync,
    switchChain: switchChainMutation.mutateAsync,
    approveApproval: approveApprovalMutation.mutateAsync,
    rejectApproval: rejectApprovalMutation.mutateAsync,
    setAutoLockDuration: setAutoLockDurationMutation.mutateAsync,
    generateMnemonic: generateMnemonicMutation.mutateAsync,
    confirmNewMnemonic: confirmNewMnemonicMutation.mutateAsync,
    importMnemonic: importMnemonicMutation.mutateAsync,
    importPrivateKey: importPrivateKeyMutation.mutateAsync,
    deriveAccount: deriveAccountMutation.mutateAsync,
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
