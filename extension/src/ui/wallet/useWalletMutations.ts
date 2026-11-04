import type { CreateFromPrivateKeyInput } from "@arx/core/wallet";
import { useMutation } from "@tanstack/react-query";
import { useWallet } from "./connection/WalletContext";
import { useWalletMutation } from "./useWalletMutation";

export function useLockWallet() {
  const { client: wallet } = useWallet();
  return useMutation({ mutationFn: () => wallet.lock() });
}

export function useCreateMnemonicWallet() {
  const { client: wallet } = useWallet();
  return useWalletMutation({
    mutationFn: async ({ password, name }: { password: string; name: string }) => {
      const { mnemonic } = await wallet.keySources.generateMnemonic();
      const result = await wallet.createFromMnemonic({ password, mnemonic, name });
      return result.status === "initialized" ? { ...result, mnemonic } : result;
    },
    gcTime: 0,
  });
}

export function useRestoreMnemonicWallet() {
  const { client: wallet } = useWallet();
  return useWalletMutation({
    mutationFn: ({ password, mnemonic, name }: { password: string; mnemonic: string; name: string }) =>
      wallet.restoreFromMnemonic({ password, mnemonic, name }),
    gcTime: 0,
  });
}

export function useCreatePrivateKeyWallet() {
  const { client: wallet } = useWallet();
  return useWalletMutation({
    mutationFn: (input: CreateFromPrivateKeyInput) => wallet.createFromPrivateKey(input),
    gcTime: 0,
  });
}
