import type { KeySourceId } from "@arx/core/keyring";
import { useWallet } from "../connection/WalletContext";
import { useWalletMutation } from "../useWalletMutation";

export function useConfirmMnemonicBackup() {
  const { client: wallet } = useWallet();
  return useWalletMutation({
    mutationFn: (keySourceId: KeySourceId) => wallet.keySources.confirmMnemonicBackup({ keySourceId }),
  });
}
