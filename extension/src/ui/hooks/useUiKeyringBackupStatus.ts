import { useMutation, useQuery } from "@tanstack/react-query";
import { app } from "@/ui/lib/app";
import { createUiKeyringBackupStatusQueryOptions } from "@/ui/lib/uiKeyringQueries";

export function useUiKeyringBackupStatus() {
  const query = useQuery(createUiKeyringBackupStatusQueryOptions());
  const markBackedUpMutation = useMutation({
    mutationFn: (keyringId: string) => app.wallet.keyrings.markBackedUp({ keyringId }),
  });

  return {
    backupStatus: query.data,
    isLoading: query.isLoading,
    error: query.error,
    markBackedUp: markBackedUpMutation.mutateAsync,
  };
}
