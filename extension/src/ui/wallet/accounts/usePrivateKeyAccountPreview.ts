import type { Namespace } from "@arx/core/namespaces";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { useWallet } from "../connection/WalletContext";
import { useWalletError } from "../useWalletError";

export function usePrivateKeyAccountPreview({ privateKey, namespace }: { privateKey: string; namespace: Namespace }) {
  const { client: wallet } = useWallet();
  const reportError = useWalletError();
  const reportPreviewError = useEffectEvent((error: unknown) => reportError(error));
  const preview = useMutation({
    mutationFn: (input: { privateKey: string; namespace: Namespace }) =>
      wallet.accounts.previewPrivateKeyAccount(input),
    gcTime: 0,
  });
  const { mutate, reset } = preview;

  useEffect(() => {
    if (privateKey) mutate({ privateKey, namespace }, { onError: reportPreviewError });
    else reset();
  }, [privateKey, namespace, mutate, reset]);

  const matchesInput = preview.variables?.privateKey === privateKey && preview.variables.namespace === namespace;
  return {
    account: matchesInput ? preview.data : undefined,
    invalid: matchesInput && preview.data === null,
  };
}
