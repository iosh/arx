import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { app } from "@/ui/lib/uiBridgeClient";
import {
  createUiKeyringBackupStatusQueryOptions,
  refreshUiKeyringBackupStatusIntoCache,
} from "@/ui/lib/uiKeyringQueries";

export function useUiKeyringBackupStatus() {
  const queryClient = useQueryClient();
  const query = useQuery(createUiKeyringBackupStatusQueryOptions());
  const markBackedUpMutation = useMutation({
    mutationFn: (keyringId: string) => app.wallet.keyrings.markBackedUp({ keyringId }),
    onSuccess: async () => {
      await refreshUiKeyringBackupStatusIntoCache(queryClient);
    },
  });

  return {
    backupStatus: query.data,
    isLoading: query.isLoading,
    error: query.error,
    markBackedUp: markBackedUpMutation.mutateAsync,
  };
}
