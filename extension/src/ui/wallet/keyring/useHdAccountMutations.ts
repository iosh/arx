import type { HdKeyringId } from "@arx/core/keyring";
import type { MovePrivateKeyAccountInput } from "@arx/core/wallet";
import { useMutation } from "@tanstack/react-query";
import { useWallet } from "../connection/WalletContext";

export function useCreateHdAccount() {
  const { client: wallet } = useWallet();

  return useMutation({
    mutationFn: (input: { hdKeyringId: HdKeyringId }) => wallet.accounts.create(input),
  });
}

export function useMovePrivateKeyAccount() {
  const { client: wallet } = useWallet();

  return useMutation({
    mutationFn: (input: MovePrivateKeyAccountInput) => wallet.accounts.move(input),
  });
}
