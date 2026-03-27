import type { UiSnapshot } from "@arx/core/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { uiClient } from "../lib/uiBridgeClient";
import { createUiSnapshotQueryOptions, writeCachedUiSnapshot } from "../lib/uiSnapshotQuery";
import { useUiPort } from "./useUiPort";

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

  const snapshotQuery = useQuery<UiSnapshot>(createUiSnapshotQueryOptions());

  // Stable callback reference to avoid effect re-execution
  const handleSnapshot = useCallback(
    (snapshot: UiSnapshot) => {
      writeCachedUiSnapshot(queryClient, snapshot);
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
    mutationFn: ({ chainRef, accountKey }: { chainRef: string; accountKey?: string | null }) =>
      uiClient.accounts.switchActive({ chainRef, accountKey }),
  });

  const switchChainMutation = useMutation({
    mutationFn: (chainRef: string) => uiClient.networks.switchActive({ chainRef }),
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
    mutationFn: (params: { accountKey: string; alias: string }) => uiClient.keyrings.renameAccount(params),
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
    mutationFn: (accountKey: string) => uiClient.keyrings.hideHdAccount({ accountKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["uiAccountsByKeyring"], exact: false });
    },
  });

  const unhideHdAccountMutation = useMutation({
    mutationFn: (accountKey: string) => uiClient.keyrings.unhideHdAccount({ accountKey }),
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
    mutationFn: (params: { accountKey: string; password: string }) => uiClient.keyrings.exportPrivateKey(params),
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
