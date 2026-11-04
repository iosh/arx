import type { Namespace } from "@arx/core/namespaces";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWallet } from "../connection/WalletContext";

export function useAccountFromPrivateKey({ privateKey, namespace }: { privateKey: string; namespace: Namespace }) {
  const { client: wallet } = useWallet();
  const derivation = useMutation({
    mutationFn: wallet.accounts.fromPrivateKey,
    gcTime: 0,
    onError: (error) => {
      console.error("[arx:ui] Failed to derive the private-key account", error);
    },
  });
  const { mutate, reset } = derivation;

  useEffect(() => {
    if (privateKey) mutate({ privateKey, namespace });
    else reset();
  }, [privateKey, namespace, mutate, reset]);

  const matchesInput = derivation.variables?.privateKey === privateKey && derivation.variables.namespace === namespace;
  return {
    account: matchesInput ? derivation.data : undefined,
    invalid: matchesInput && derivation.data === null,
  };
}
