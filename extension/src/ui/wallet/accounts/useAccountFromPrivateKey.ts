import type { ChainRef } from "@arx/core/networks";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWallet } from "../connection/WalletContext";

export function useAccountFromPrivateKey({
  privateKey,
  chainRef,
}: {
  privateKey: string;
  chainRef: ChainRef | undefined;
}) {
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
    if (privateKey && chainRef) mutate({ privateKey, chainRef });
    else reset();
  }, [privateKey, chainRef, mutate, reset]);

  const matchesInput = derivation.variables?.privateKey === privateKey && derivation.variables.chainRef === chainRef;
  return {
    account: matchesInput ? derivation.data : undefined,
    invalid: matchesInput && derivation.data === null,
  };
}
